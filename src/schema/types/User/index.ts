import { argon2id, hash, verify } from "argon2";
import Joi from "joi";
import { extendType, nonNull, objectType, stringArg } from "nexus";

import { destroySession, uniqueDiscriminator } from "./util";

export const AuthPayload = objectType({
  name: "AuthPayload",
  definition(t) {
    t.field("user", { type: User });
  },
});

export const LogOutPayload = objectType({
  name: "LogOutPayload",
  definition(t) {
    t.string("sessionId");
  },
});

export const User = objectType({
  name: "User",
  definition(t) {
    t.model.id();
    t.model.email();
    t.model.username();
    t.model.discriminator();
  },
});

export const UserQuery = extendType({
  type: "Query",
  definition(t) {
    t.crud.user();
    t.crud.users();
    t.field("me", { type: User, resolve: (_root, _args, ctx) => ctx.user });
  },
});

export const UserMutation = extendType({
  type: "Mutation",
  definition(t) {
    t.field("signUp", {
      type: AuthPayload,
      args: {
        email: nonNull(stringArg()),
        username: nonNull(stringArg()),
        password: nonNull(stringArg()),
      },
      argSchema: Joi.object({
        email: Joi.string().email(),
        username: Joi.string().min(3).max(20).trim(),
        password: Joi.string().min(8),
      }),
      resolve: async (_root, { email, username, password }, ctx) => {
        const discriminator = await uniqueDiscriminator(ctx.prisma, username);
        if (discriminator === undefined) {
          throw new Error("Too many users have this username");
        }
        const passwordHash = await hash(password, { type: argon2id });
        const user = await ctx.prisma.user.create({
          data: { discriminator, email, passwordHash, username },
        });
        ctx.req.session.userId = user.id;
        return { user };
      },
    });

    t.field("logIn", {
      type: AuthPayload,
      args: {
        email: nonNull(stringArg()),
        password: nonNull(stringArg()),
      },
      resolve: async (_root, { email, password }, ctx) => {
        const errMsg = "Invalid login credentials";
        const user = await ctx.prisma.user.findUnique({ where: { email } });
        if (!user) {
          throw new Error(errMsg);
        }
        const validPassword = await verify(user.passwordHash, password);
        if (!validPassword) {
          throw new Error(errMsg);
        }
        ctx.req.session.userId = user.id;
        return { user };
      },
    });

    t.field("logOut", {
      type: LogOutPayload,
      resolve: async (_root, _args, ctx) => {
        const { session } = ctx.req;
        try {
          await destroySession(session);
        } catch (err) {
          throw new Error(err);
        }
        return { sessionId: session.id };
      },
    });
  },
});
