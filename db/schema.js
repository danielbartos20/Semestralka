import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  surname: text('surname').notNull(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
});

export const chats = sqliteTable('chats', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  creatorId: integer('creator_id').notNull().references(() => users.id),
});

export const chatUsers = sqliteTable('chat_users', {
  id: integer('id').primaryKey(),
  chatId: integer('chat_id').notNull().references(() => chats.id),
  userId: integer('user_id').notNull().references(() => users.id),
});

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey(),
  chatId: integer('chat_id').notNull().references(() => chats.id),
  userId: integer('user_id').notNull().references(() => users.id),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});