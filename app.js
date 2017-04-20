var restify = require('restify');
var builder = require('botbuilder');

var util = require('./util');
var ssml = require('./ssml');
var config = require('./config');

function speak(session, prompt) {
    var localized = session.gettext(prompt);
    return ssml.speak(localized);
}

var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});

var connector = new builder.ChatConnector({
    appId: config.appId,
    appPassword: config.appPassword
});

server.post('/api/messages', connector.listen());

var bot = new builder.UniversalBot(connector, function (session) {
    // Default: open main menu
    session.replaceDialog('MenuDialog');
});

bot.dialog('MenuDialog', function (session) {
    var card = new builder.HeroCard(session)
        .title('menu_title')
        .buttons([
            builder.CardAction.imBack(session, 'new game', 'New game'),
            builder.CardAction.imBack(session, 'challenge', 'Challenge a friend'),
            builder.CardAction.imBack(session, 'leaderboard', 'Leaderboard')
        ]);
    var msg = new builder.Message(session)
        .speak(speak(session, 'menu_ssml'))
        .addAttachment(card)
        .inputHint(builder.InputHint.acceptingInput);
    session.send(msg).endDialog();
}).triggerAction({
    matches: [
        /help/i,
        /menu/i
    ]
});

bot.dialog('GameDialog', [
    function (session, args) {
        var game = args.game || session.conversationData.game;

        if (!game) {
            game = {
                turn: 0,
                lastWord: ""
            }
        }

        var word = util.getSurvivalWord();
        var title = session.gettext('question_title', game.turn + 1);
        var subtitle = session.gettext('question_subtitle', word);

        var card = new builder.HeroCard(session)
            .title(title)
            .subtitle(subtitle);
        var msg = new builder.Message(session)
            .speak(speak(session, 'question_ssml'))
            .addAttachment(card)
            .inputHint(builder.InputHint.acceptingInput);

        game.lastWord = word;
        game.turn++;

        session.send(msg).endDialog();
    }
]).triggerAction({
    matches: [
        /new game/i,
        /start game/i
    ]
});

bot.dialog('LeaderboardDialog', function (session) {
    var card = new builder.HeroCard(session)
        .title('leaderboard_title')
        .subtitle(util.getLeaderboard())
        .buttons([
            builder.CardAction.imBack(session, 'menu', 'Back to menu')
        ]);
    var msg = new builder.Message(session)
        .speak(speak(session, 'leaderboard_ssml'))
        .addAttachment(card)
        .inputHint(builder.InputHint.acceptingInput);
    session.send(msg).endDialog();
}).triggerAction({
    matches: [
        /high scores?/i,
        /leaderboard/i,
        /winners?/i
    ]
});

bot.dialog('ChallengeDialog', [
    function (session) {
        var game = session.dialogData.game = {
            turn: 0,
            opponent: null,
            lastWord: null
        };

        builder.Prompts.text(session, 'challenge_choose', {
            speak: speak(session, 'challenge_choose_ssml')
        });
    },

    function (session, results) {
        var game = session.dialogData.game;
        game.opponent = results.response;

        var prompt = session.gettext('challenge_confirm', game.opponent);
        builder.Prompts.confirm(session, prompt, {
            speak: speak(session, 'challenge_confirm_ssml')
        });
    },

    function (session, results) {
        var game = session.dialogData.game;
        var isSuccess = results.response;
        var subtitle = isSuccess ? session.gettext('challenge_success', game.opponent) : session.gettext('challenge_cancel', game.opponent);
        var spokenText = isSuccess ? 'challenge_success_ssml' : 'challenge_cancel_ssml';

        var card = new builder.HeroCard(session)
            .title('challenge_title')
            .subtitle(subtitle)
            .buttons([
                builder.CardAction.imBack(session, 'menu', 'Back to menu')
            ]);
        var msg = new builder.Message(session)
            .speak(speak(session, spokenText))
            .addAttachment(card)
            .inputHint(builder.InputHint.acceptingInput);
        session.send(msg).endDialog();
    }
]).triggerAction({
    matches: [
        /challenge/i,
        /multiplayer/i,
        /invite/i
    ]
});