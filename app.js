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
    var game = getGame(session);
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
    token = token || null;
    challengeToken = challengeToken || null;

    return {
        turn: 0,
        score: 0,
        lastWord: null,
        words: [],
        challengeToken: challengeToken,
        token: token
    };
}

function saveGame(session, game) {
    session.dialogData.game = game;
}

function getGame(session) {
    return session.dialogData.game;
}

function randomName() {
    var names = ["Jeanett", "Bruno", "Shakita", "Beaulah", "Nobuko", "Adolfo", "Denae", "Misha", "Jonathon", "Odilia", "Gale", "Kori", "Renato", "Joesph", "Racquel", "Claude", "Colleen", "Ambrose", "Penney", "Leanna", "Letitia", "Caroyln", "Marcelene", "Rickie", "Tobie", "Ava", "Wallace", "Rusty", "Verena", "Magdalene", "Lise", "Latoyia", "Mariam", "Keely", "Karlyn", "Rosanne", "Chi", "Amparo", "Mac", "Tiffani", "Tyesha", "Jaqueline", "Kam", "Carlita", "Debby", "Eartha", "Jeffrey", "Shawnta", "Ursula", "Amal"];
    var i = util.getRandomInt(0, names.length - 1);

    return names[i];
}

var gameOver = function (session) {
    var game = getGame(session);

    var myScore = game.score;
    var theirScore = game.opponentScore;

    var subtitle;
    var spokentext;

    if (myScore > theirScore) {
        // You win :)
        subtitle = session.gettext("gameover_win", myScore, theirScore);
        spokentext = ssml.speak(session.gettext("gameover_win_ssml"), [myScore, theirScore]);
    }
    else if (theirScore > myScore) {
        // They win :(
        subtitle = session.gettext("gameover_loss", myScore, theirScore);
        spokentext = ssml.speak(session.gettext("gameover_loss_ssml"), [myScore, theirScore]);
    }
    else {
        // Draw :|
        subtitle = session.gettext("gameover_draw", myScore);
        spokentext = ssml.speak(session.gettext("gameover_draw_ssml"), [myScore]);
    }

    var title = session.gettext("gameover_title");

    var card = new builder.HeroCard(session)
        .images(cardImages(session))
        .title(title)
        .subtitle(subtitle)
        .buttons([
            builder.CardAction.imBack(session, 'new game', 'New game'),
            builder.CardAction.imBack(session, 'menu', 'Back to menu')
        ]);

    var msg = new builder.Message(session)
        .speak(spokentext)
        .addAttachment(card)
        .inputHint(builder.InputHint.acceptingInput);

    // TODO: Get name from Cortana entities
    util.addToLeaderboard(randomName(), game.token, game.words, game.score, function () { });
    saveGame(session, null);
    session.send(msg).endDialog();
}

var gamePrompt = function (session, word) {
    var game = getGame(session);

    var title = game.challengeToken ? session.gettext('question_chtitle', game.turn + 1) : session.gettext('question_title', game.turn + 1);
    var subtitle = session.gettext('question_subtitle');

    var prominentWord = ssml.emphasis(word, null, {
        level: "strong"
    });

    var spokentext = ssml.speak(session.gettext('question_ssml'), [game.turn + 1, prominentWord, prominentWord]);

    game.turn++;
    game.lastWord = word;
    saveGame(session, game);

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
            saveGame(session, args.game);
        }

        next && next();
    })
    .matches(/define|definition/i, function (session) {
        var game = getGame(session);
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
        var game = getGame(session);

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
        var game = getGame(session);
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
        var game = getGame(session);

        var title = session.gettext('finalscore_title');
        var subtitle = session.gettext('finalscore_subtitle', game.score, game.turn, game.token);

        if (game.challengeToken) {
            // Accepted the challenge and leaving it now via quit
            gameOver(session);
            return;
        }

        var card = new builder.HeroCard(session)
            .images(cardImages(session))
            .title(title)
            .subtitle(subtitle)
            .buttons([
                builder.CardAction.imBack(session, 'new game', 'New game'),
                builder.CardAction.imBack(session, 'menu', 'Back to menu')
            ]);

        var msg = new builder.Message(session)
            .speak(subtitle)
            .addAttachment(card)
            .inputHint(builder.InputHint.acceptingInput);

        // TODO: Get name from Cortana entities
        util.addToLeaderboard(randomName(), game.token, game.words, game.score, function () { });

        saveGame(session, null);
        session.send(msg).endDialog();
    })
    .onDefault(function (session) {
        var gameLoop = function () {
            var game = getGame(session);
            var resp = session.message ? util.strip(session.message.text) : "";

            if (resp && resp.indexOf('next') < 0 && game.lastWord) {
                // A game is already in progress, at least one word was shown, 
                // and didn't request the next one yet, need to show the results first.
                var answer = util.strip(game.lastWord);

                // Still waiting for 'next' or 'finish' from previous round                
                if (game.isIdle) {
                    resp = game.lastAnswer;
                }

                // (!) When spelling letter by letter, Cortana will send uppercase: "SAMPLE"
                // Need a way to distinguish between that, typing the answer and cheating 
                // (so pronouncing the word itself in Cortana : "sample")
                console.log(`${resp} vs ${answer}`);
                var isCorrect = resp.indexOf(answer) > -1;

                if (!game.isIdle) {
                    // If isIdle, already did all this and waiting for response now
                    isCorrect && ++game.score;
                    game.words.push(game.lastWord);
                    saveGame(session, game);
                }

                var createCard = function (err, challengeScore) {
                    var title = isCorrect ? "answer_correct_title" : "answer_incorrect_title";

                    // The results of the round, spelling etc
                    var subtitle = isCorrect ? session.gettext("answer_correct_subtitle", answer, util.spell(answer)) : session.gettext("answer_incorrect_subtitle", answer, util.spell(resp), util.spell(answer));

                    // Score so far
                    subtitle += session.gettext("answer_subtitle", game.score, game.turn);

                    // Challenge score, if relevant
                    if (game.challengeToken && challengeScore) {
                        subtitle += "\n\n" + session.gettext("challenge_score", challengeScore);

                        // Cache locally
                        game.opponentScore = challengeScore;
                        saveGame(session, game);
                    }

                    // All of the above + description of commands
                    var spokentext = ssml.speak(subtitle + "... " + session.gettext("answer_next_ssml"));

                    var card = new builder.HeroCard(session)
                        .images(cardImages(session))
                        .title(title)
                        .subtitle(subtitle)
                        .buttons([
                            builder.CardAction.imBack(session, 'next round', 'Next round'),
                            builder.CardAction.imBack(session, 'finish', 'Finish game')
                        ]);

                    var msg = new builder.Message(session)
                        .speak(spokentext)
                        .addAttachment(card)
                        .inputHint(builder.InputHint.acceptingInput);

                    game.isIdle = true;
                    game.lastAnswer = resp;
                    saveGame(session, game);

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
            else if (resp && resp.indexOf('next') >= 0) {
                // Ready for the next round
                game.isIdle = false;
                saveGame(session, game);
            }

            if (game.challengeToken) {
                util.getChallengeWord(game.challengeToken, game.turn, function (err, word, end) {
                    if (err) {
                        console.error(err);
                        return;
                    }

                    if (!end && word) {
                        gamePrompt(session, word);
                    }
                    else {
                        // Ran out of words in the challenge -> compare the scores now
                        gameOver(session);
                    }
                });
            }
            else {
                util.getSurvivalWord(7, function (err, word) {
                    if (err) {
                        console.error(err);
                        return;
                    }

                    gamePrompt(session, word);
                });
            }
        }

        if (getGame(session)) {
            gameLoop();
        }
        else {
            util.generateToken(function (err, token) {
                if (err) {
                    console.error(err);
                    return;
                }

                var game = newGame(token);
                saveGame(session, game);
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
    util.getLeaderboard(function (err, msg) {
        if (err) {
            console.error(err);
            return;
        }

        //TODO: Need to gather (some) names and pretty print the msg here before we show it live
        // Until then, printing demo string
        var isDemo = true;
        if (isDemo) {
            msg = "- Satya N : 92 pts\n\n- Dmitrii C : 82 pts\n\n- Ondrej S : 81 pts\n\n- Mark Z : 2 pts";
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
        if (!session.dialogData.token) {
            // Accepting a challenge
            util.generateToken(function (err, token) {
                if (err) {
                    console.error(err);
                    return;
                }

                var challengeToken = session.dialogData.challengeToken;
                if (challengeToken) {
                    var game = newGame(token, challengeToken);
                    session.replaceDialog("GameDialog", { game: game });
                }
                else {
                    session.replaceDialog("MenuDialog");
                }

            });
        }
        else {
            // Creating a challenge
            var game = newGame(session.dialogData.token);
            session.replaceDialog("GameDialog", { game: game });
        }

    })
    .matches(/join|accept/i, [
        function (session) {
            builder.Prompts.text(session, 'challenge_join', {
                speak: speak(session, 'challenge_join_ssml')
            });
        },

        function (session, results) {
            var token = util.strip(results.response);
            util.validateToken(token, function (err, valid) {
                if (valid) {
                    session.dialogData.challengeToken = token;

                    var card = new builder.HeroCard(session)
                        .images(cardImages(session))
                        .title('challenge_title')
                        .subtitle('challenge_success')
                        .buttons([
                            builder.CardAction.imBack(session, 'start', 'Start challenge'),
                            builder.CardAction.imBack(session, 'menu', 'Cancel')
                        ]);

                    var msg = new builder.Message(session)
                        .speak(speak(session, 'challenge_success_ssml'))
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
                        .speak(speak(session, 'challenge_failure_ssml'))
                        .addAttachment(card)
                        .inputHint(builder.InputHint.acceptingInput);

                    session.send(msg);
                }
            });
        }
    ])
    .matches(/create|new/i, function (session) {
        util.generateToken(function (err, newToken) {
            session.dialogData.token = newToken;
            var subtitle = session.gettext('challenge_create', newToken);
            var spokentext = ssml.speak(session.gettext('challenge_create_ssml'), [newToken]);

            var card = new builder.HeroCard(session)
                .images(cardImages(session))
                .title('challenge_title')
                .subtitle(subtitle)
                .buttons([
                    builder.CardAction.imBack(session, 'start', 'Start challenge'),
                    builder.CardAction.imBack(session, 'menu', 'Cancel')
                ]);

            var msg = new builder.Message(session)
                .speak(spokentext)
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