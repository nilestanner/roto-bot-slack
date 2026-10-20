const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

// index.js is a script: it reads env vars, wires up a Botkit controller and registers handlers
// at load time. We load it fresh for each test with a fake controller (no Slack, no botkit install)
// and a pinned clock, then drive the registered handlers directly.

const indexPath = path.join(__dirname, '..', 'index.js');
const integrationPath = path.join(__dirname, '..', 'lib', 'custom_integrations.js');

const ENV_KEYS = ['ROTATION', 'STARTDATE', 'TOKEN', 'SLACK_TOKEN', 'CLIENT_ID', 'CLIENT_SECRET', 'PORT', 'MONGOLAB_URI'];
let savedEnv;
let originalLoad;

const fakeController = () => {
  const c = { events: {}, hears: [] };
  c.on = (name, fn) => { c.events[name] = fn; };
  c.hears = (pattern, context, fn) => { c.hearsHandlers.push({ pattern, context, fn }); };
  c.hearsHandlers = [];
  return c;
};

// Loads index.js with the given env and a fake controller. Returns { controller, configureArgs }.
const loadBot = ({ rotation = 'Alice,Bob,Carol', startDate = '2024-01-01', env = {} } = {}) => {
  process.env.TOKEN = 'xoxb-test';
  if (rotation !== null) process.env.ROTATION = rotation;
  if (startDate !== null) process.env.STARTDATE = startDate;
  Object.assign(process.env, env);

  const controller = fakeController();
  const configureArgs = [];
  Module._load = function (request, parent, isMain) {
    if (request === './lib/custom_integrations') {
      return { configure: (...args) => { configureArgs.push(args); return controller; } };
    }
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[indexPath];
  delete require.cache[integrationPath];
  require(indexPath);
  return { controller, configureArgs };
};

const handlerFor = (controller, pattern) => controller.hearsHandlers.find(h => h.pattern === pattern).fn;

// Botkit messages are plain objects with a `text` field.
const message = (text) => ({ text });

const runPager = (controller, text) => {
  const replies = [];
  const bot = { reply: (msg, reply) => replies.push(reply) };
  handlerFor(controller, 'pager')(bot, message(text));
  return replies;
};

describe('roto-bot index.js', () => {
  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
    originalLoad = Module._load;
    mock.method(console, 'log', () => {});
  });

  afterEach(() => {
    Module._load = originalLoad;
    mock.timers.reset();
    mock.restoreAll();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
    }
  });

  describe('startup', () => {
    it('configures a custom integration when TOKEN is set', () => {
      const { configureArgs } = loadBot();
      assert.strictEqual(configureArgs.length, 1);
      assert.strictEqual(configureArgs[0][0], 'xoxb-test');
      assert.strictEqual(configureArgs[0][1].json_file_store, './db_slack_bot_ci/');
    });

    it('accepts SLACK_TOKEN as an alternative to TOKEN', () => {
      delete process.env.TOKEN;
      const controller = fakeController();
      const args = [];
      process.env.SLACK_TOKEN = 'slack-tok';
      process.env.ROTATION = 'A,B';
      process.env.STARTDATE = '2024-01-01';
      Module._load = function (request) {
        if (request === './lib/custom_integrations') {
          return { configure: (...a) => { args.push(a); return controller; } };
        }
        return originalLoad.apply(this, arguments);
      };
      delete require.cache[indexPath];
      require(indexPath);
      assert.strictEqual(args[0][0], 'slack-tok');
    });

    it('exits with an error when no credentials are configured', () => {
      process.env.ROTATION = 'A,B';
      process.env.STARTDATE = '2024-01-01';
      mock.method(process, 'exit', (code) => { throw new Error('exit ' + code); });
      delete require.cache[indexPath];
      assert.throws(() => require(indexPath), /exit 1/);
    });

    it('throws at load time if ROTATION is not set', () => {
      assert.throws(() => loadBot({ rotation: null }), TypeError);
    });

    it('registers the expected handlers', () => {
      const { controller } = loadBot();
      assert.ok(controller.events.rtm_open);
      assert.ok(controller.events.rtm_close);
      assert.ok(controller.events.bot_channel_join);
      assert.deepStrictEqual(controller.hearsHandlers.map(h => [h.pattern, h.context]),
        [['hello', 'direct_message'], ['pager', 'ambient']]);
    });

    it('greets on hello and when joining a channel', () => {
      const { controller } = loadBot();
      const replies = [];
      const bot = { reply: (m, r) => replies.push(r) };
      handlerFor(controller, 'hello')(bot, {});
      controller.events.bot_channel_join(bot, {});
      assert.deepStrictEqual(replies, ['Hello!', "I'm here!"]);
    });
  });

  describe('pager rotation', () => {
    // 2024-01-01 is a Monday; rotation starts with Alice that week.
    const at = (iso) => mock.timers.enable({ apis: ['Date'], now: new Date(iso) });

    it('reports the first person during the first week', () => {
      const { controller } = loadBot();
      at('2024-01-03T12:00:00');
      assert.deepStrictEqual(runPager(controller, 'who has the pager'), ['Alice']);
    });

    it('advances one person per week', () => {
      const { controller } = loadBot();
      at('2024-01-09T12:00:00');
      assert.deepStrictEqual(runPager(controller, 'pager?'), ['Bob']);
      mock.timers.reset();
      at('2024-01-16T12:00:00');
      assert.deepStrictEqual(runPager(controller, 'pager?'), ['Carol']);
    });

    it('wraps around after a full rotation', () => {
      const { controller } = loadBot();
      at('2024-01-22T12:00:00'); // week 3
      assert.deepStrictEqual(runPager(controller, 'pager'), ['Alice']);
    });

    it('with "next" reports the following week\'s person', () => {
      const { controller } = loadBot();
      at('2024-01-03T12:00:00');
      const [reply] = runPager(controller, 'pager next');
      assert.match(reply, /^The next person on pager is Bob starting on Jan, 07$/);
    });

    it('with "schedule" lists everyone once, one line per week', () => {
      const { controller } = loadBot();
      at('2024-01-03T12:00:00');
      const [reply] = runPager(controller, 'pager schedule');
      assert.deepStrictEqual(reply.split('\n'), [
        'Alice has pager for week of Jan, 03',
        'Bob has pager for week of Jan, 10',
        'Carol has pager for week of Jan, 17'
      ]);
    });

    it('"schedule" takes precedence over "next"', () => {
      const { controller } = loadBot();
      at('2024-01-03T12:00:00');
      const [reply] = runPager(controller, 'pager next schedule');
      assert.match(reply, /has pager for week of/);
    });

    it('works with a single-person rotation', () => {
      const { controller } = loadBot({ rotation: 'Solo' });
      at('2024-03-20T12:00:00');
      assert.deepStrictEqual(runPager(controller, 'pager'), ['Solo']);
    });

    it('matches keywords case-insensitively', () => {
      const { controller } = loadBot();
      at('2024-01-03T12:00:00');
      assert.match(runPager(controller, 'PAGER Schedule')[0], /has pager for week of/);
      assert.match(runPager(controller, 'Pager NEXT')[0], /^The next person on pager is/);
    });

    it('handles a real Botkit message object ({ text }) and replies to that message', () => {
      const { controller } = loadBot();
      at('2024-01-03T12:00:00');
      const replies = [];
      const msg = { text: 'pager', channel: 'C1' };
      handlerFor(controller, 'pager')({ reply: (m, r) => replies.push([m, r]) }, msg);
      assert.deepStrictEqual(replies, [[msg, 'Alice']]);
    });

    // BUG (not fixed in this PR): before STARTDATE the week diff is negative, so the modulo yields
    // a negative index and the bot replies "undefined".
    it('handles dates before STARTDATE',
      { todo: 'negative week offset indexes people[-n] and returns undefined' },
      () => {
        const { controller } = loadBot();
        at('2023-12-20T12:00:00');
        const [reply] = runPager(controller, 'pager');
        assert.ok(['Alice', 'Bob', 'Carol'].includes(reply), `got ${reply}`);
      });
  });
});
