import { PrismaClient } from "@prisma/client";
import { argon2id, hash, verify } from "argon2";
import { randomInt } from "crypto";
import Joi from "joi";
import { extendType, nonNull, objectType, stringArg } from "nexus";
import { promisify } from "util";

import { isAuthenticated } from "../rules";

const uniqueDiscriminator = async (
  prisma: PrismaClient,
  username: string,
  uniquenessChecks = 5,
  discriminatorMax = 10_000
): Promise<number | undefined> => {
  const possibleDiscriminators = Array.from({ length: uniquenessChecks }, () =>
    randomInt(discriminatorMax)
  );
  for (const discriminator of possibleDiscriminators) {
    const existingUser = await prisma.user.findUnique({
      where: { Tag: { username, discriminator } },
    });
    if (!existingUser) {
      return discriminator;
    }
  }
};

export const User = objectType({
  name: "User",
  definition(t) {
    t.model.createdAt();
    t.model.discriminator();
    t.model.email();
    t.model.emailVerified();
    t.model.id();
    t.model.username();
  },
});

export const UserPayload = objectType({
  name: "UserPayload",
  definition(t) {
    t.field("user", { type: User });
  },
});

export const UserLogOutPayload = objectType({
  name: "UserLogOutPayload",
  definition(t) {
    t.string("sessionId");
  },
});

export const Query = extendType({
  type: "Query",
  definition(t) {
    t.crud.user();
    t.crud.users();
    t.field("me", { type: User, resolve: (_root, _args, ctx) => ctx.user });
  },
});

export const Mutation = extendType({
  type: "Mutation",
  definition(t) {
    t.field("userSignUp", {
      type: UserPayload,
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

    t.field("userLogIn", {
      type: UserPayload,
      args: {
        email: nonNull(stringArg()),
        password: nonNull(stringArg()),
      },
      resolve: async (_root, { email, password }, ctx) => {
        const errMsg = "Incorrect email or password";
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

    t.field("userLogOut", {
      type: UserLogOutPayload,
      resolve: async (_root, _args, ctx) => {
        const { req } = ctx;
        const {
          session: { sessionId },
        } = req;
        const destroySession = promisify(req.destroySession.bind(req));

        try {
          await destroySession();
        } catch (err) {
          throw new Error(err);
        }
        return { sessionId };
      },
    });

    t.field("userUpdateUsername", {
      type: UserPayload,
      shield: isAuthenticated(),
      args: { newUsername: nonNull(stringArg()) },
      argSchema: Joi.object({
        newUsername: Joi.string().min(3).max(20).trim(),
      }),
      resolve: async (_root, { newUsername }, ctx) => {
        if (newUsername === ctx.user?.username) {
          return { user: ctx.user };
        }

        let discriminator = ctx.user?.discriminator;
        const discriminatorTaken = !!(await ctx.prisma.user.findUnique({
          where: {
            Tag: { username: newUsername, discriminator: discriminator || 0 },
          },
        }));

        if (discriminatorTaken) {
          discriminator = await uniqueDiscriminator(ctx.prisma, newUsername);
          if (discriminator === undefined) {
            throw new Error("Too many users have this username");
          }
        }

        const updatedUser = await ctx.prisma.user.update({
          data: { username: newUsername, discriminator },
          where: { id: ctx.user?.id },
        });

        return { user: updatedUser };
      },
    });

    t.field("userUpdatePassword", {
      type: UserPayload,
      shield: isAuthenticated(),
      args: {
        currentPassword: nonNull(stringArg()),
        newPassword: nonNull(stringArg()),
      },
      argSchema: Joi.object({
        currentPassword: Joi.string(),
        newPassword: Joi.string().min(8),
      }),
      resolve: async (_root, { currentPassword, newPassword }, ctx) => {
        if (!ctx.user) {
          return { user: null };
        }
        const validPassword = await verify(
          ctx.user.passwordHash,
          currentPassword
        );
        if (!validPassword) {
          throw new Error("Incorrect password");
        }
        const newPasswordHash = await hash(newPassword, { type: argon2id });
        const updatedUser = await ctx.prisma.user.update({
          data: { passwordHash: newPasswordHash },
          where: { id: ctx.user.id },
        });
        return { user: updatedUser };
      },
    });

    t.field("userUpdateEmail", {
      type: UserPayload,
      shield: isAuthenticated(),
      args: {
        newEmail: nonNull(stringArg()),
      },
      argSchema: Joi.object({
        newEmail: Joi.string().email(),
      }),
      resolve: async (_root, { newEmail }, ctx) => {
        if (!ctx.user) {
          return { user: null };
        }
        if (ctx.user.email === newEmail) {
          return { user: ctx.user };
        }
        const updatedUser = await ctx.prisma.user.update({
          data: { email: newEmail, emailVerified: false },
          where: { id: ctx.user.id },
        });
        return { user: updatedUser };
      },
    });

    t.field("userDeleteAccount", {
      type: UserPayload,
      shield: isAuthenticated(),
      resolve: async (_root, _args, ctx) => {
        const deletedUser = await ctx.prisma.user.delete({
          where: { id: ctx.user?.id },
        });
        return { user: deletedUser };
      },
    });
  },
});
