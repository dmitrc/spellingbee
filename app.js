var restify = require('restify');
var builder = require('botbuilder');

var util = require('./util');
var ssml = require('./ssml');
var config = require('./config');

function speak(session, prompt, vars) {
    var localized = session.gettext(prompt, vars);
    return ssml.speak(localized);
}

function gameButtons(session) {
    var game = session.conversationData.game;
    var btns = [];

    btns.push(builder.CardAction.imBack(session, 'repeat', "Repeat the word"));
    btns.push(builder.CardAction.imBack(session, 'define', "Request definition"));
    btns.push(builder.CardAction.imBack(session, 'sentence', "Request example sentence"));

    return btns;
}

function cardImages(session) {
    return [builder.CardImage.create(session, 'http://i.imgur.com/k5LJvpV.png')];
}

function newGame(token, challengeToken) {
    return {
        turn: 0,
        score: 0,
        lastWord: null,
        words: [],
        challengeToken: challengeToken,
        token: token
    };
}

util.readWordStats(function (err) {
    if (err) {
        console.error(err);
    }
});

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
        .images(cardImages(session))
        .title('menu_title')
        .buttons([
            builder.CardAction.imBack(session, 'new game', 'New game'),
            builder.CardAction.imBack(session, 'challenge', 'Challenge a friend'),
            builder.CardAction.imBack(session, 'leaderboard', 'Leaderboard'),
            builder.CardAction.imBack(session, 'about', 'About')
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
    .onBegin(function (session, args, next) {
        if (args && args.game) {
            session.conversationData.game = args.game;
        }

        next && next();
    })
    .matches(/define|definition/i, function (session) {
        var game = session.conversationData.game;
        util.getDefinition(game.lastWord, function (err, definition) {
            var title = game.challengeToken ? session.gettext('question_chtitle', game.turn) : session.gettext('question_title', game.turn);
            var subtitle = session.gettext('definition_subtitle', definition);

            var card = new builder.HeroCard(session)
                .images(cardImages(session))
                .title(title)
                .subtitle(subtitle)
                .buttons(gameButtons(session));

            var msg = new builder.Message(session)
                .speak(subtitle)
                .addAttachment(card)
                .inputHint(builder.InputHint.acceptingInput);

            session.send(msg);
        });
    })
    .matches(/repeat/i, function (session) {
        var game = session.conversationData.game;

        var title = game.challengeToken ? session.gettext('question_chtitle', game.turn) : session.gettext('question_title', game.turn);
        var subtitle = session.gettext('question_subtitle');

        var prominentWord = ssml.emphasis(game.lastWord, null, {
            level: "strong"
        });

        var spokentext = ssml.speak(session.gettext('question_ssml'), [game.turn, prominentWord, prominentWord]);

        var card = new builder.HeroCard(session)
            .images(cardImages(session))
            .title(title)
            .subtitle(subtitle)
            .buttons(gameButtons(session));

        var msg = new builder.Message(session)
            .speak(spokentext)
            .addAttachment(card)
            .inputHint(builder.InputHint.acceptingInput);

        session.send(msg);
    })
    .matches(/sentence/i, function (session) {
        var game = session.conversationData.game;
        util.getSentence(game.lastWord, function (err, sentence) {
            var title = game.challengeToken ? session.gettext('question_chtitle', game.turn) : session.gettext('question_title', game.turn);
            var subtitle = session.gettext('sentence_subtitle', sentence.replace(game.lastWord, "____"));
            var spokentext = session.gettext('sentence_subtitle', sentence);

            var card = new builder.HeroCard(session)
                .images(cardImages(session))
                .title(title)
                .subtitle(subtitle)
                .buttons(gameButtons(session));

            var msg = new builder.Message(session)
                .speak(spokentext)
                .addAttachment(card)
                .inputHint(builder.InputHint.acceptingInput);

            session.send(msg);
        });
    })
    .matches(/finish/i, function (session) {
        var game = session.conversationData.game;

        var title = session.gettext('finalscore_title');
        var subtitle = session.gettext('finalscore_subtitle', game.score, game.turn);

        if (game.challengeToken) {
            subtitle += "\n\n" + session.gettext('finalscore_chsubtitle');
        }

        var card = new builder.HeroCard(session)
            .images(cardImages(session))
            .title(title)
            .subtitle(subtitle);

        var msg = new builder.Message(session)
            .speak(subtitle)
            .addAttachment(card)
            .inputHint(builder.InputHint.acceptingInput);

        session.conversationData.game = null;
        session.send(msg).endDialog();

        // TODO: Get name from Cortana entities
        util.addToLeaderboard("name", game.token, game.words, game.score, function () { });
    })
    .onDefault(function (session, args) {
        var gameResponse = function (word) {
            var game = session.conversationData.game;

            var title = game.challengeToken ? session.gettext('question_chtitle', game.turn + 1) : session.gettext('question_title', game.turn + 1);
            var subtitle = session.gettext('question_subtitle');
            
            var prominentWord = ssml.emphasis(word, null, {
                level: "strong"
            });

            var spokentext = ssml.speak(session.gettext('question_ssml'), [game.turn + 1, prominentWord, prominentWord]);

            game.turn++;
            game.lastWord = word;
            session.conversationData.game = game;

            var card = new builder.HeroCard(session)
                .images(cardImages(session))
                .title(title)
                .subtitle(subtitle)
                .buttons(gameButtons(session));

            var msg = new builder.Message(session)
                .speak(spokentext)
                .addAttachment(card)
                .inputHint(builder.InputHint.acceptingInput);

            session.send(msg);
        }

        var gameLoop = function () {
            var game = session.conversationData.game;
            var resp = session.message ? util.strip(session.message.text) : "";

            if (game.lastWord && resp.indexOf('next') < 0) {
                // A game is already in progress, at least one word was shown, 
                // and didn't request the next one yet, need to show the results first.
                var answer = util.strip(game.lastWord);

                // (!) When spelling letter by letter, Cortana will send uppercase: "SAMPLE"
                // Need a way to distinguish between that, typing the answer and cheating 
                // (so pronouncing the word itself in Cortana : "sample")
                console.log(`${resp} vs ${answer}`);
                var isCorrect = resp.indexOf(answer) > -1;

                if (isCorrect) {
                    game.score++;
                    game.words.push(game.lastWord);
                    session.conversationData.game = game;
                }

                var createCard = function(err, score) {
                    var title = isCorrect ? "answer_correct_title" : "answer_incorrect_title";

                    var subtitle = isCorrect ? session.gettext("answer_correct_subtitle", answer, util.spell(answer)) : session.gettext("answer_incorrect_subtitle", answer, util.spell(resp), util.spell(answer));

                    if (score >= 0) {
                        // Won't be printed if no score is available yet (-1)
                        subtitle += "\n\n" + session.gettext("challenge_score", score);
                    }
                    
                    subtitle += session.gettext("answer_subtitle", game.score, game.turn);    

                    var card = new builder.HeroCard(session)
                        .images(cardImages(session))
                        .title(title)
                        .subtitle(subtitle)
                        .buttons([
                            builder.CardAction.imBack(session, 'next round', 'Next round'),
                            builder.CardAction.imBack(session, 'finish', 'Finish game')
                        ]);

                    var msg = new builder.Message(session)
                        .speak(ssml.speak(subtitle))
                        .addAttachment(card)
                        .inputHint(builder.InputHint.acceptingInput);

                    session.send(msg);
                } 

                if (game.challengeToken) {
                    util.getChallengeScore(game.challengeToken, createCard);
                }
                else {
                    createCard();
                }

                return;
            }

            if (game.challengeToken) {
                util.getChallengeWord(game.challengeToken, game.turn, function (err, word, won) {
                    if (err) {
                        console.error(err);
                        return;
                    }

                    gameResponse(word);
                });
            }
            else {
                util.getSurvivalWord(7, function (err, word) {
                    if (err) {
                        console.error(err);
                        return;
                    }

                    gameResponse(word);
                });
            }
        }

        if (session.conversationData.game) {
            gameLoop();
        }
        else {
            util.generateToken(function (err, token) {
                if (err) {
                    console.error(err);
                    return;
                }

                var game = newGame(token);
                session.conversationData.game = game;
                gameLoop();
            });
        }
    })
)
    .triggerAction({
        matches: [
            /new game/i,
            /start/i
        ]
    });

bot.dialog('LeaderboardDialog', function (session) {
    util.getLeaderboard(function(err, msg) { 
        if (err) {
            console.error(err);
            return;
        }

        var card = new builder.HeroCard(session)
            .images(cardImages(session))
            .title('leaderboard_title')
            .subtitle(msg)
            .buttons([
                builder.CardAction.imBack(session, 'menu', 'Back to menu')
            ]);
        var msg = new builder.Message(session)
            .speak(speak(session, 'leaderboard_ssml'))
            .addAttachment(card)
            .inputHint(builder.InputHint.acceptingInput);
        session.send(msg).endDialog();
    });
}).triggerAction({
    matches: [
        /high scores?/i,
        /leaderboard/i,
        /winners?/i
    ]
});

bot.dialog('ChallengeDialog', new builder.IntentDialog()
    .matches(/menu/i, function (session) {
        session.replaceDialog('MenuDialog');
    })
    .matches(/start/i, function (session) {

        if(!session.conversationData.token) {
            // Accepting a challenge
            util.generateToken(function (err, token) {
                if (err) {
                    console.error(err);
                    return;
                }

                if(session.conversationData.challengeToken) {
                    var game = newGame(token, session.conversationData.challengeToken);
                    session.replaceDialog("GameDialog", { game: game });
                }
                else {
                    session.replaceDialog("MenuDialog");
                }
            
            });
        }
        else{
            // Creating a challenge
            var game = newGame(session.conversationData.token);
            session.replaceDialog("GameDialog", { game: game });
        }
        
    })
    .matches(/join|accept/i, [
        function (session) {
            builder.Prompts.text(session, 'challenge_join', {
                speak: speak(session, 'challenge_join')
            });
        },

        function (session, results) {
            var token = results.response;
            util.validateToken(token, function (err, valid) {
                if (valid) {
                    session.conversationData.challengeToken = token;

                    var card = new builder.HeroCard(session)
                        .images(cardImages(session))
                        .title('challenge_title')
                        .subtitle('challenge_success')
                        .buttons([
                            builder.CardAction.imBack(session, 'start', 'Start challenge'),
                            builder.CardAction.imBack(session, 'menu', 'Cancel')
                        ]);

                    var msg = new builder.Message(session)
                        .speak(speak(session, 'challenge_success'))
                        .addAttachment(card)
                        .inputHint(builder.InputHint.acceptingInput);

                    session.send(msg);
                }
                else {
                    var card = new builder.HeroCard(session)
                        .images(cardImages(session))
                        .title('challenge_title')
                        .subtitle('challenge_failure')
                        .buttons([
                            builder.CardAction.imBack(session, 'join', 'Try again'),
                            builder.CardAction.imBack(session, 'menu', 'Back to menu')
                        ]);

                    var msg = new builder.Message(session)
                        .speak(speak(session, 'challenge_failure'))
                        .addAttachment(card)
                        .inputHint(builder.InputHint.acceptingInput);

                    session.send(msg);
                }
            });
        }
    ])
    .matches(/create|new/i, function (session) {
        util.generateToken(function (err, newToken) {
            session.conversationData.token = newToken;
            var subtitle = session.gettext('challenge_create', newToken);

            var card = new builder.HeroCard(session)
                .images(cardImages(session))
                .title('challenge_title')
                .subtitle(subtitle)
                .buttons([
                    builder.CardAction.imBack(session, 'start', 'Start challenge'),
                    builder.CardAction.imBack(session, 'menu', 'Cancel')
                ]);

            var msg = new builder.Message(session)
                .speak(subtitle)
                .addAttachment(card)
                .inputHint(builder.InputHint.acceptingInput);

            session.send(msg);
        });
    })
    .onDefault(function (session) {
        var card = new builder.HeroCard(session)
            .images(cardImages(session))
            .title('challenge_title')
            .subtitle('challenge_subtitle')
            .buttons([
                builder.CardAction.imBack(session, 'create', 'Create a new challenge'),
                builder.CardAction.imBack(session, 'join', 'Accept a challenge'),
                builder.CardAction.imBack(session, 'menu', 'Back to menu')
            ]);

        var msg = new builder.Message(session)
            .speak(speak(session, 'challenge_ssml'))
            .addAttachment(card)
            .inputHint(builder.InputHint.acceptingInput);

        session.send(msg);
    })
).triggerAction({
    matches: [
        /challenge/i,
        /multiplayer/i,
        /invite/i
    ]
});

bot.dialog("AboutDialog", function (session) {
    var card = new builder.HeroCard(session)
        .images(cardImages(session))
        .title('about_title')
        .subtitle('about_subtitle')
        .buttons([
            builder.CardAction.imBack(session, 'menu', 'Back to menu')
        ]);

    var msg = new builder.Message(session)
        .speak(speak(session, 'about_ssml'))
        .addAttachment(card)
        .inputHint(builder.InputHint.acceptingInput);

    session.send(msg).endDialog();
}).triggerAction({
    matches: [
        /about/i,
        /author/i,
        /feedback/i
    ]
})