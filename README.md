# Roto bot
See who's on pager!

## Commands:

* `pager`
Any phrase with the word pager in it will tell you who is currently on pager

* `pager` + `next`
Any phrase with the words next and pager will tell you who is next on pager

* `pager` + `schedule`
Any phrase with the words pager and schedule will print out the pager shedule for the next full rotation. Everyone on the pager will be listed once.

## Enviromental vars:
* ROTOATION
This is a comma seperated list of names in your rotation schedule. They should be in the order that you wish the pager rotation to happen.
* STARTDATE
This is the starting date of your pager rotation. This should be updated anytime you add or remove people from the rotation. The input format is : `YYYY-MM-DD`
* TOKEN
This is your slack api token

## Set up
1. Clone the Repo
2. Run `npm install`
3. Add your env vars
4. Run npm start

The bot should connect automatically to what ever slack org that the bot was created in. (when you got the api key)

