import express from "express";
import compression from "compression";
import { urlAlphabet, customAlphabet } from "nanoid";
import passport from "passport";
import session from "express-session";
import {
  generateAttestationOptions,
  verifyAttestationResponse,
  generateAssertionOptions,
  verifyAssertionResponse,
} from "@simplewebauthn/server";

import { Users } from "./db/users.mjs";
import initializePassport from "./passport-config.mjs";

const nanoid = customAlphabet(urlAlphabet, 25);

const rpName = "Petsgramm";
const rpID = process.env.HOST_NAME;
const origin = `https://${rpID}`;

const users = new Users();

initializePassport(
  passport,
  (id) => users.getById(id),
  (id) => users.getByCredentialID(id),
  async (user, options, expectedChallenge) => {
    const authenticator = user.devices.find(
      (device) => device.credentialID === options.id
    );

    if (!authenticator) {
      throw new Error(`Could not find authenticator`);
    }

    const verification = await verifyAssertionResponse({
      credential: options,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator,
    });

    const { verified, authenticatorInfo } = verification;

    return verified;
  }
);

const app = express();

app.use(compression());

app.use(express.static("./public"));
app.use(express.static("./build"));
app.use(express.static("./common"));

app.set("view-engine", "ejs");
app.set("views", "./client/views");
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(
  session({
    secret: "secret",
    resave: false,
    saveUninitialized: true,
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.get("/", (req, res) => {
  res.render("index.ejs", {
    user: req.user,
  });
});

app.get("/profile", checkAuthenticated, (req, res) => {
  res.render("profile.ejs", { user: req.user, later: req.session.later });
});

app.get("/later", checkAuthenticated, (req, res) => {
  req.session.later = true;
  res.render("later.ejs");
});

app.get("/signin", checkNotAuthenticated, (req, res) => {
  res.render("signin.ejs");
});

app.get("/signup", checkNotAuthenticated, (req, res) => {
  res.render("signup.ejs");
});

app.get("/add-key", checkAuthenticated, async (req, res) => {
  res.render("add-key.ejs");
});

app.post("/add-key/challenge", (req, res) => {
  const user = req.user;

  const optionsForOptions = {
    rpName,
    rpID,
    userName: user.name,
    userID: user.id,
    attestationType: "none",
  };

  optionsForOptions.excludeCredentials = user.devices.map((dev) => ({
    id: dev.credentialID,
    type: "public-key",
  }));

  const options = generateAttestationOptions(optionsForOptions);

  // Save challenge
  req.session.challenge = options.challenge;

  res.json({ options });
});

app.post("/add-key/verify", checkAuthenticated, async (req, res) => {
  const user = req.user;
  const expectedChallenge = req.session.challenge;

  try {
    const verification = await verifyAttestationResponse({
      credential: req.body.options,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });

    const { verified, authenticatorInfo } = verification;
    console.log("authenticatorInfo", authenticatorInfo);

    const { base64PublicKey, base64CredentialID, counter } = authenticatorInfo;

    const newAuthenticator = {
      name: req.body.nick,
      credentialID: base64CredentialID,
      publicKey: base64PublicKey,
      counter,
    };

    users.addDevice(user.id, newAuthenticator);

    res.json({ success: verified });
  } catch (error) {
    console.log(error);
    res.json({ error: error.message });
  }
});

app.post("/key/challenge", checkAuthenticated, (req, res) => {
  const user = req.user;

  const allowCredentials = user.devices.map((dev) => ({
    id: dev.credentialID,
    type: "public-key",
  }));

  const options = generateAssertionOptions({
    allowCredentials,
    userVerification: "required",
  });

  req.session.challenge = options.challenge;

  res.json({ options });
});

app.post("/key/verify", checkAuthenticated, async (req, res) => {
  const user = req.user;
  const expectedChallenge = req.session.challenge;

  try {
    const authenticator = user.devices.find(
      (device) => device.credentialID === req.body.id
    );

    if (!authenticator) {
      throw new Error(`Could not find authenticator`);
    }

    const verification = await verifyAssertionResponse({
      credential: req.body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator,
    });

    const { verified, authenticatorInfo } = verification;

    if (verified) {
      req.session.later = false;
    }

    res.json({ success: verified });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// Loginless
app.post("/signup/challenge", checkNotAuthenticated, (req, res) => {
  const { name } = req.body;

  const user = users.createUser({ name });

  const optionsForOptions = {
    rpName,
    rpID,
    userName: user.name,
    userID: user.id,
    attestationType: "none",
    authenticatorSelection: {
      requireResidentKey: true,
      userVerification: "required",
    },
  };

  const options = generateAttestationOptions(optionsForOptions);

  req.session.challenge = options.challenge;
  req.session.user = user;

  res.json({ options });
});

app.post("/signup", checkNotAuthenticated, async (req, res) => {
  const user = req.session.user;
  const expectedChallenge = req.session.challenge;

  try {
    const verification = await verifyAttestationResponse({
      credential: req.body.options,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });

    const { verified, authenticatorInfo } = verification;
    console.log("authenticatorInfo", authenticatorInfo);

    const { base64PublicKey, base64CredentialID, counter } = authenticatorInfo;

    const newAuthenticator = {
      name: req.body.nick,
      credentialID: base64CredentialID,
      publicKey: base64PublicKey,
      counter,
    };

    if (!verified) {
      return res.json({ success: false, error: "Key not verified" });
    }

    users.add(user);
    users.addDevice(user.id, newAuthenticator);

    await login(req, user);

    res.json({ success: true });
  } catch (error) {
    console.log(error);
    res.json({ error: error.message });
  }
});

app.post("/signin/challenge", checkNotAuthenticated, (req, res) => {
  const options = generateAssertionOptions({
    rpID,
    userVerification: "required",
  });

  req.session.challenge = options.challenge;

  res.json({ options });
});

app.post("/signin", checkNotAuthenticated, function (req, res, next) {
  passport.authenticate("local", function (err, user, info) {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.json({ error: info.message });
    }
    req.logIn(user, function (err) {
      if (err) {
        return next(err);
      }
      return res.json({ success: true });
    });
  })(req, res, next);
});

app.post("/logout", (req, res) => {
  req.logOut();
  res.redirect("/signin");
});

function checkAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }

  res.redirect("/signin");
}

function checkNotAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect("/");
  }
  next();
}

function login(req, user) {
  return new Promise((resolve, reject) => {
    req.login(user, function (err) {
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
}

app.listen(3000, () => {
  console.log("Server ready");
});
