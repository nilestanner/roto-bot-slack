const moment = require('moment');
require('dotenv').config();
const people = process.env.ROTATION.split(',');
const startDate = moment(process.env.STARTDATE,'YYYY-MM-DD');

function onInstallation(bot, installer) {
    if (installer) {
        bot.startPrivateConversation({user: installer}, function (err, convo) {
            if (err) {
                console.log(err);
            } else {
                convo.say('I am a bot that has just joined your team');
                convo.say('You must now /invite me to a channel so that I can be of use!');
            }
        });
    }
}

var config = {};
if (process.env.MONGOLAB_URI) {
    var BotkitStorage = require('botkit-storage-mongo');
    config = {
        storage: BotkitStorage({mongoUri: process.env.MONGOLAB_URI}),
    };
} else {
    config = {
        json_file_store: ((process.env.TOKEN)?'./db_slack_bot_ci/':'./db_slack_bot_a/'), //use a different name if an app or CI
    };
}

if (process.env.TOKEN || process.env.SLACK_TOKEN) {
    //Treat this as a custom integration
    var customIntegration = require('./lib/custom_integrations');
    var token = (process.env.TOKEN) ? process.env.TOKEN : process.env.SLACK_TOKEN;
    var controller = customIntegration.configure(token, config, onInstallation);
} else if (process.env.CLIENT_ID && process.env.CLIENT_SECRET && process.env.PORT) {
    //Treat this as an app
    var app = require('./lib/apps');
    var controller = app.configure(process.env.PORT, process.env.CLIENT_ID, process.env.CLIENT_SECRET, config, onInstallation);
} else {
    console.log('Error: If this is a custom integration, please specify TOKEN in the environment. If this is an app, please specify CLIENTID, CLIENTSECRET, and PORT in the environment');
    process.exit(1);
}


controller.on('rtm_open', function (bot) {
    console.log('** The RTM api just connected!');
});

controller.on('rtm_close', function (bot) {
    console.log('** The RTM api just closed');
    // you may want to attempt to re-open
});


/**
 * Core bot logic goes here!
 */
// BEGIN EDITING HERE!

controller.on('bot_channel_join', function (bot, message) {
    bot.reply(message, "I'm here!")
});

controller.hears('hello', 'direct_message', function (bot, message) {
    bot.reply(message, 'Hello!');
});



controller.hears('pager', 'ambient', function (bot, message) {
    message = message.toLowerCase();
    if (message.text.includes('schedule')) {
        const reply = people.map((person, index) => {
            const date = moment().add(index, 'week');
            const onPager = getOnPager(date);
            return `${onPager} has pager for week of ${date.format('MMM, DD')}`;
        }).join('\n');
        bot.reply(message,reply);
    } else if (message.text.includes('next')) {
        const nextDate = moment().add(1, 'week');
        const nextPager = getOnPager(nextDate);
        const reply = `The next person on pager is ${nextPager} starting on ${nextDate.startOf('week').format('MMM, DD')}`;
        bot.reply(message, reply);
    } else {
        bot.reply(message, getOnPager(moment()));
    }
    
});

const getOnPager = (date) => {
    const week = date.diff(startDate, 'weeks');
    return people[week % people.length];
}