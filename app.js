var restify = require('restify');
var builder = require('botbuilder');

var util = require('./util');
var ssml = require('./ssml');
var config = require('./config');

function speak(session, prompt, vars) {
    var localized = session.gettext(prompt, vars);
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

bot.dialog('GameDialog', new builder.IntentDialog()
    .matches(/define/i, function (session) {
        var game = session.conversationData.game;
        var definition = util.getDefinition(game.lastWord);

        var title = session.gettext('question_title', game.turn);
        var subtitle = session.gettext('definition_subtitle', definition);

         var card = new builder.HeroCard(session)
            .title(title)
            .subtitle(subtitle)
            .buttons([
                builder.CardAction.imBack(session, 'repeat', "Repeat the word"),
                builder.CardAction.imBack(session, 'define', "Request definition"),
                builder.CardAction.imBack(session, 'sentence', "Request example sentence"),
                builder.CardAction.imBack(session, 'finish', "Finish game")
            ]);
        var msg = new builder.Message(session)
            .speak(subtitle)
            .addAttachment(card)
            .inputHint(builder.InputHint.acceptingInput);

        session.send(msg);
    })
    .matches(/repeat/i, function (session) {
        var game = session.conversationData.game;

        var title = session.gettext('question_title', game.turn);
        var subtitle = session.gettext('question_subtitle');
        var ssml = speak(session, 'question_ssml', game.lastWord);

        var card = new builder.HeroCard(session)
            .title(title)
            .subtitle(subtitle)
            .buttons([
                builder.CardAction.imBack(session, 'repeat', "Repeat the word"),
                builder.CardAction.imBack(session, 'define', "Request definition"),
                builder.CardAction.imBack(session, 'sentence', "Request example sentence"),
                builder.CardAction.imBack(session, 'finish', "Finish game")
            ]);
        var msg = new builder.Message(session)
            .speak(ssml)
            .addAttachment(card)
            .inputHint(builder.InputHint.acceptingInput);

        session.send(msg);
    })
    .matches(/sentence/i, function (session) {
        var game = session.conversationData.game;
        var definition = util.getSentence(game.lastWord);

        var title = session.gettext('question_title', game.turn);
        var subtitle = session.gettext('sentence_subtitle', definition);

         var card = new builder.HeroCard(session)
            .title(title)
            .subtitle(subtitle)
            .buttons([
                builder.CardAction.imBack(session, 'repeat', "Repeat the word"),
                builder.CardAction.imBack(session, 'define', "Request definition"),
                builder.CardAction.imBack(session, 'sentence', "Request example sentence"),
                builder.CardAction.imBack(session, 'finish', "Finish game")
            ]);
        var msg = new builder.Message(session)
            .speak(subtitle)
            .addAttachment(card)
            .inputHint(builder.InputHint.acceptingInput);

        session.send(msg);
    })
    .matches(/finish/i, function (session, args) {
        args = args || {};
        var game = args.game || session.conversationData.game;

        var title = session.gettext('finalscore_title');
        var subtitle = session.gettext('finalscore_subtitle', game.score, game.turn - 1);

         var card = new builder.HeroCard(session)
            .title(title)
            .subtitle(subtitle);
        var msg = new builder.Message(session)
            .speak(subtitle)
            .addAttachment(card)
            .inputHint(builder.InputHint.acceptingInput);

        session.send(msg).endDialog();
    })
    .onDefault(function (session) {
        var game = session.conversationData.game;

        if (!game) {
            game = {
                turn: 0,
                score: 0,
                lastWord: "",
                opponent: null
            }
        }
        else {
            // A game is already in progress, need to show the results first
            var resp = session.message ? session.message.text : "";
            var answer = game.lastWord;

            // (!) When spelling letter by letter, Cortana will send uppercase: SAMPLE
            // Need a way to distinguish between that, typing the answer and cheating 
            // (so pronouncing the word itself in Cortana)
            var isCorrect = resp.toLowerCase().indexOf(answer.toLowerCase()) > -1;

            if (isCorrect) {
                game.score++;
                session.conversationData.game = game;
            }

            var title = isCorrect ? "answer_correct_title" : "answer_incorrect_title";
            var subtitle = session.gettext("answer_subtitle", resp, answer, game.score);

            var card = new builder.HeroCard(session)
                .title(title)
                .subtitle(subtitle);
            var msg = new builder.Message(session)
                .speak(subtitle)
                .addAttachment(card)
                .inputHint(builder.InputHint.acceptingInput);

            session.send(msg);
        }

        var word = util.getSurvivalWord();
        var title = session.gettext('question_title', game.turn + 1);
        var subtitle = session.gettext('question_subtitle');
        var ssml = speak(session, 'question_ssml', word);

        game.turn++;
        game.lastWord = word;
        session.conversationData.game = game;

        var card = new builder.HeroCard(session)
            .title(title)
            .subtitle(subtitle)
            .buttons([
                builder.CardAction.imBack(session, 'repeat', "Repeat the word"),
                builder.CardAction.imBack(session, 'define', "Request definition"),
                builder.CardAction.imBack(session, 'sentence', "Request example sentence"),
                builder.CardAction.imBack(session, 'finish', "Finish game")
            ]);
        var msg = new builder.Message(session)
            .speak(ssml)
            .addAttachment(card)
            .inputHint(builder.InputHint.acceptingInput);

        session.send(msg);
    })
)
.triggerAction({
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