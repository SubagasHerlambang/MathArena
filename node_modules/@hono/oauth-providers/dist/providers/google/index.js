// src/providers/google/googleAuth.ts
import { env } from "hono/adapter";
import { getCookie, setCookie } from "hono/cookie";
import { HTTPException as HTTPException2 } from "hono/http-exception";

// src/utils/getRandomState.ts
var rand = () => {
  return Math.random().toString(36).substr(2);
};
function getRandomState() {
  return `${rand()}-${rand()}-${rand()}`;
}

// src/providers/google/authFlow.ts
import { HTTPException } from "hono/http-exception";

// src/utils/objectToQuery.ts
function toQueryParams(params) {
  const elements = Object.keys(params);
  elements.forEach((element) => {
    if (params[element] === void 0) {
      delete params[element];
    }
  });
  return new URLSearchParams(params).toString();
}

// src/providers/google/authFlow.ts
var AuthFlow = class {
  client_id;
  client_secret;
  redirect_uri;
  code;
  token;
  scope;
  state;
  login_hint;
  prompt;
  user;
  granted_scopes;
  access_type;
  constructor({
    client_id,
    client_secret,
    redirect_uri,
    login_hint,
    prompt,
    scope,
    state,
    code,
    token,
    access_type
  }) {
    this.client_id = client_id;
    this.client_secret = client_secret;
    this.redirect_uri = redirect_uri;
    this.login_hint = login_hint;
    this.prompt = prompt;
    this.scope = scope;
    this.state = state;
    this.code = code;
    this.token = token;
    this.user = void 0;
    this.granted_scopes = void 0;
    this.access_type = access_type;
    if (this.client_id === void 0 || this.client_secret === void 0 || this.scope === void 0) {
      throw new HTTPException(400, {
        message: "Required parameters were not found. Please provide them to proceed."
      });
    }
  }
  redirect() {
    const parsedOptions = toQueryParams({
      response_type: "code",
      redirect_uri: this.redirect_uri,
      client_id: this.client_id,
      include_granted_scopes: true,
      scope: this.scope.join(" "),
      state: this.state,
      prompt: this.prompt,
      login_hint: this.login_hint,
      access_type: this.access_type
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${parsedOptions}`;
  }
  async getTokenFromCode() {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        clientId: this.client_id,
        clientSecret: this.client_secret,
        redirect_uri: this.redirect_uri,
        code: this.code,
        grant_type: "authorization_code"
      })
    }).then((res) => res.json());
    if ("error" in response) {
      throw new HTTPException(400, { message: response.error_description });
    }
    if ("access_token" in response) {
      this.token = {
        token: response.access_token,
        expires_in: response.expires_in
      };
      this.granted_scopes = response.scope.split(" ");
    }
  }
  async getUserData() {
    await this.getTokenFromCode();
    const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        authorization: `Bearer ${this.token?.token}`
      }
    }).then((res) => res.json());
    if ("error" in response) {
      throw new HTTPException(400, { message: response.error?.message });
    }
    if ("id" in response) {
      this.user = response;
    }
  }
};

// src/providers/google/googleAuth.ts
function googleAuth(options) {
  return async (c, next) => {
    const newState = options.state || getRandomState();
    const auth = new AuthFlow({
      client_id: options.client_id || env(c).GOOGLE_ID,
      client_secret: options.client_secret || env(c).GOOGLE_SECRET,
      redirect_uri: options.redirect_uri || c.req.url.split("?")[0],
      login_hint: options.login_hint,
      prompt: options.prompt,
      access_type: options.access_type,
      scope: options.scope,
      state: newState,
      code: c.req.query("code"),
      token: {
        token: c.req.query("access_token"),
        expires_in: Number(c.req.query("expires-in"))
      }
    });
    if (!auth.code) {
      setCookie(c, "state", newState, {
        maxAge: 60 * 10,
        httpOnly: true,
        path: "/"
        // secure: true,
      });
      return c.redirect(auth.redirect());
    }
    if (c.req.url.includes("?")) {
      const storedState = getCookie(c, "state");
      if (c.req.query("state") !== storedState) {
        throw new HTTPException2(401);
      }
    }
    await auth.getUserData();
    c.set("token", auth.token);
    c.set("user-google", auth.user);
    c.set("granted-scopes", auth.granted_scopes);
    await next();
  };
}

// src/providers/google/revokeToken.ts
async function revokeToken(token) {
  const response = await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
    method: "POST",
    headers: { "Content-type": "application/x-www-form-urlencoded" }
  });
  return response.status === 200;
}
export {
  googleAuth,
  revokeToken
};
