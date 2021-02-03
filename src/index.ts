import Fastify, { FastifyInstance } from "fastify";
import cookie from "fastify-cookie";
import helmet from "fastify-helmet";
import redis from "fastify-redis";
import session from "fastify-session";
import mercurius from "mercurius";

import { config } from "./config";
import { buildContext } from "./context";
import { schema } from "./schema";

declare module "fastify" {
  interface Session {
    userId: string;
  }
}

const isProduction = () => config.env === "production";

const build = async () => {
  const app = Fastify();

  await app.register(helmet, {
    contentSecurityPolicy: isProduction() ? undefined : false,
  });
  await app.register(cookie);
  await app.register(redis, { url: config.redisUrl });
  await app.register(session, {
    cookie: {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: true,
      secure: isProduction(),
    },
    cookieName: "user_session",
    saveUninitialized: false,
    secret: config.appSecret,
  });
  await app.register(mercurius, {
    context: buildContext,
    graphiql: isProduction() ? false : "playground",
    path: "/",
    schema,
  });

  return app;
};

const launch = (app: FastifyInstance, port: number) =>
  app.listen(port, "::", (_e, address) => console.info(`🚀 ${address}`));

build()
  .then((app) => launch(app, config.port))
  .catch((e) => console.error(e));
