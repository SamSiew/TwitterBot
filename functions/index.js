require("dotenv/config");
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// Database reference
const appregion = process.env.APP_REGION
const dbRef = admin.firestore().doc('auth_tokens/demo');

// Twitter API init
const TwitterApi = require('twitter-api-v2').default;
const twitterClient = new TwitterApi({
  clientId: process.env.TWITTER_CLIENT_ID,
  clientSecret: process.env.TWITTER_CLIENT_SECRET
});

const callbackURL = 'http://127.0.0.1:5000/twitterbot-9ff9d/asia-southeast1/callback';

// OpenAI API init
const { Configuration, OpenAIApi } = require('openai');
const configuration = new Configuration({
  organization: process.env.OPEN_AI_ORG,
  apiKey: process.env.OPEN_AI_API,
});

const openai = new OpenAIApi(configuration);

// STEP 1 - Auth URL
exports.auth = functions.region(appregion).https.onRequest(async (request, response) => {
  const { url, codeVerifier, state } = twitterClient.generateOAuth2AuthLink(
    callbackURL,
    { scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] }
  );

  await dbRef.set({ codeVerifier, state });

  response.redirect(url);
});

// STEP 2 - Verify callback code, store access_token 
exports.callback = functions.region(appregion).https.onRequest(async (request, response) => {
  const { state, code } = request.query;

  const dbSnapshot = await dbRef.get();
  const { codeVerifier, state: storedState } = dbSnapshot.data();

  const {
    client: loggedClient,
    accessToken,
    refreshToken,
  } = await twitterClient.loginWithOAuth2({
    code,
    codeVerifier,
    redirectUri: callbackURL,
  });

  await dbRef.set({ accessToken, refreshToken });

  const { data } = await loggedClient.v2.me(); // start using the client if you want

  return response.status(200).send(data);
});

// STEP 3 - Refresh tokens and post tweets
exports.tweet = functions.region(appregion).https.onRequest(async (request, response) => {
  const { refreshToken } = (await dbRef.get()).data();

  const {
    client: refreshedClient,
    accessToken,
    refreshToken: newRefreshToken,
  } = await twitterClient.refreshOAuth2Token(refreshToken);

  await dbRef.set({ accessToken, refreshToken: newRefreshToken });

  const textTweet = await openai.createCompletion({
    model: "text-davinci-002",
    prompt: "This is a test",
    max_tokens: 64
  });

  await refreshedClient.v2.tweet(
    textTweet.data.choices[0].text.replace(/\s/g,'').substring(0,100)
  ).then((data) => response.status(200).send(data)).catch((err) => response.status(400).send(JSON.stringify(err)))
});
