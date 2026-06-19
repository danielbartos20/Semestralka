import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import ejs from 'ejs';
import bcrypt from 'bcryptjs';
import { db } from './db/db.js';
import { users, chats, chatUsers, messages } from './db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createNodeWebSocket } from '@hono/node-ws';

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
const port = 8080;
const activeConnections = {};

app.use('/public/*', serveStatic({ 
    root: './public',
    rewriteRequestPath: (path) => path.replace(/^\/public/, '')
}));

app.get('/', async function (c) {
    const {message, type} = getFlashMessage(c);
    const loggedUser = await getLoggedUser(c);
    const html = await ejs.renderFile('./views/index.ejs', { message, type, user: loggedUser });
    return c.html(html);
});

app.get('/register', async function (c) {
    const {message, type} = getFlashMessage(c);
    const html = await ejs.renderFile('./views/register.ejs', {message, type});
    return c.html(html);
});

app.post('/register', async function (c) {
    const body = await c.req.parseBody();
    const name = body.name;
    const surname = body.surname;
    const username = body.username;
    const password = body.password;
    const password2 = body.password2;
    if (!username || !password) {
        setFlashMessage(c, 'Vyplňte prosím všechna pole.', 'error');
        return c.redirect('/register');
    };
    if (password !== password2) {
        setFlashMessage(c, 'Hesla se neshodují', 'error');
        return c.redirect('/register');
    };
    try {
        const existingUser = await db.select().from(users).where(eq(users.username, username)).limit(1);
        if (existingUser.length > 0) {
            setFlashMessage(c, 'Toto uživatelské jméno už existuje.', 'error');
            return c.redirect('/register');
        };
        
        const passwordHash = await bcrypt.hash(password, 10);

        await db.insert(users).values({ name, surname, username, passwordHash });
        setFlashMessage(c, 'Registrace proběhla úspěšně! Nyní se můžete přihlásit.', 'success');
        return c.redirect('/register');
    } catch (error) {
        console.error("Chyba při registraci uživatele:", error);
        setFlashMessage(c, 'Při registraci nastala chyba. Zkuste to prosím znovu.', 'error');
        return c.redirect('/register');
    };
});

app.get('/login', async function (c) {
    const {message, type} = getFlashMessage(c);
    const html = await ejs.renderFile('./views/login.ejs', {message, type});
    return c.html(html);
});

app.post('/login', async function (c) {
    const body = await c.req.parseBody();
    const username = body.username;
    const password = body.password;
    if (!username || !password){
        setFlashMessage(c, 'Vyplňte prosím všechna pole.', 'error');
        return c.redirect('/login');
    };

    try{
        const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
        const user = result[0];
        if (!user || !(await bcrypt.compare(password, user.passwordHash))){
            setFlashMessage(c, 'Nesprávné uživatelské jméno nebo heslo.', 'error');
            return c.redirect('/login');
        };
        setCookie(c, 'user_id', user.id.toString(), {
            path: '/',
            httpOnly: true,
            maxAge: 60*60*24*7
        });
        setFlashMessage(c, 'Byli jste úspěšně přihlášeni!', 'success');
        return c.redirect('/');
    } catch (error) {
        console.log('Chyba při přihlašování: ', error);
        setFlashMessage(c, 'Při přihlašování nastala chyba. Zkuste to prosím znovu.', 'error');
        return c.redirect('/login');
    };
});

app.get('/logout', function (c) {
    deleteCookie(c, 'user_id', { path: '/' });
    setFlashMessage(c, 'Byli jste úspěšně odhlášeni.', 'success');
    return c.redirect('/')
});

app.get('/chats', async function (c) {
    const loggedUser = await getLoggedUser(c);
    if (!loggedUser) {
        setFlashMessage(c, 'Pro zobrazení chatů se musíte přihlásit.', 'error');
        return c.redirect('/login');
    }; 
    const {message, type} = getFlashMessage(c);
    const userChats = await db.select({
        id: chats.id,
        name: chats.name
    }).from(chats).innerJoin(chatUsers, eq(chats.id, chatUsers.chatId)).where(eq(chatUsers.userId, loggedUser.id));
    const html = await ejs.renderFile('./views/chats.ejs', {message, type, user: loggedUser, chats: userChats});
    return c.html(html);
});

app.post('/chats', async function (c) {
    const loggedUser = await getLoggedUser(c);
    if (!loggedUser) {
        return c.redirect('/login');
    };
    const body = await c.req.parseBody();
    const name = body.name;
    if(name) {
        const result = await db.insert(chats).values({name}).returning();
        const newChat = result[0];
        await db.insert(chatUsers).values({chatId: newChat.id, userId: loggedUser.id});
        setFlashMessage(c, 'Chat vytvořen.', 'success');
    };
    return c.redirect('/chats');
});

app.get('/chat/:id', async function (c) {
    const loggedUser = await getLoggedUser(c);
    if(!loggedUser) {
        return c.redirect('/login');
    };
    const chatId = Number(c.req.param('id'));
    const chatResult = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
    const chat = chatResult[0];
    if(!chat){
        setFlashMessage(c, 'Tento chat neexistuje.', 'error');
        return c.redirect('/chats');
    };
    const membership = await db.select().from(chatUsers).where(and(eq(chatUsers.chatId, chatId), eq(chatUsers.userId, loggedUser.id))).limit(1);
    if(membership.length === 0) {
        setFlashMessage(c, 'Do tohoto chatu nemáte přístup.', 'error');
        return c.redirect('/chats');
    };
    const {message, type} = getFlashMessage(c);
    const chatMessages = await db.select({
        content: messages.content,
        createdAt: messages.createdAt,
        name: users.name,
        surname: users.surname
    }).from(messages).leftJoin(users, eq(messages.userId, users.id)).where(eq(messages.chatId, chatId)).orderBy(asc(messages.createdAt));
    const members = await db.select({
        name: users.name,
        surname: users.surname
    }).from(chatUsers).innerJoin(users, eq(chatUsers.userId, users.id)).where(eq(chatUsers.chatId, chatId));
    const html = await ejs.renderFile('./views/chat.ejs', {message, type, chat, members, messages: chatMessages, user: loggedUser});
    return c.html(html);
});

app.get('/ws/chat/:id', upgradeWebSocket(async function (c) {
    const loggedUser = await getLoggedUser(c);
    const chatId = Number(c.req.param('id'));
        return {
            onOpen(event, ws) {
                if (!activeConnections[chatId]) activeConnections[chatId] = new Set();
                activeConnections[chatId].add({ ws, user: loggedUser });
            },
            async onMessage(event, ws) {
                const content = event.data;
                if (!content || !loggedUser) return;
                await db.insert(messages).values({
                    chatId: chatId,
                    userId: loggedUser.id,
                    content: content
                });

                const msgObject = JSON.stringify({ name: loggedUser.name, surname: loggedUser.surname, content: content });
                if (activeConnections[chatId]) {
                    activeConnections[chatId].forEach(client => client.ws.send(msgObject));
                };
        },
        onClose(event, ws) {
            if (activeConnections[chatId]) {
                activeConnections[chatId].forEach(client => {
                    if (client.ws === ws) activeConnections[chatId].delete(client);
                });
            };
        }
    };
}));

app.post('/chat/:id/add-user', async function (c) {
    const loggedUser = await getLoggedUser(c);
    if(!loggedUser) {
        return c.redirect('/login');
    };
    const chatId = Number(c.req.param('id'));
    const body = await c.req.parseBody();
    const usernameToAdd = body.username;
    const userResult = await db.select().from(users).where(eq(users.username, usernameToAdd)).limit(1);
    const userToAdd = userResult[0];
    if (!userToAdd) {
        setFlashMessage(c, 'Uživatel s tímto e-mailem neexistuje.', 'error');
        return c.redirect(`/chat/${chatId}`);
    };
    const existingMember = await db.select().from(chatUsers).where(and(eq(chatUsers.chatId, chatId), eq(chatUsers.userId, userToAdd.id))).limit(1);
    if (existingMember.length > 0) {
        setFlashMessage(c, 'Tento uživatel už v chatu je.', 'error');
        return c.redirect(`/chat/${chatId}`);
    };
    await db.insert(chatUsers).values({
        chatId: chatId,
        userId: userToAdd.id
    });
    setFlashMessage(c, `Uživatel ${userToAdd.name} ${userToAdd.surname} přidán.`, 'success');
    return c.redirect(`/chat/${chatId}`);
});



async function getLoggedUser(c) {
    const userId = getCookie(c, 'user_id');
    if (!userId) {
        return null;
    };
    const result = await db.select().from(users).where(eq(users.id, Number(userId))).limit(1);
    return result[0] || null;
};

function setFlashMessage(c, message, type) {
    setCookie(c, 'flash_message', message, { path: '/' });
    setCookie(c, 'flash_type', type, { path: '/' });
};

function getFlashMessage(c) {
    const message = getCookie(c, 'flash_message');
    let type = getCookie(c, 'flash_type');
    if (message) {
        deleteCookie(c, 'flash_message', { path: '/' });
        deleteCookie(c, 'flash_type', { path: '/' });
    };
    if (type !== 'success' && type !== 'error') {
        type = '';
    };
    return { message, type };
};

const server = serve({
    fetch: app.fetch,
    port: port
});
injectWebSocket(server);