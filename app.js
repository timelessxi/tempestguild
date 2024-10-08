const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path = require('path');
const db = require('./config/db'); // Your database connection
const flash = require('connect-flash'); // Flash messages




const authRoutes = require('./routes/auth'); // Auth routes for login/register/logout
const indexRoutes = require('./routes/index'); // Main routes for the application
const profileRoutes = require('./routes/profile'); // Profile routes for viewing/editing user profiles
const errorRoutes = require('./routes/404'); // Error routes for 404 pages

const app = express();
const PORT = process.env.PORT || 3000;


// Middleware
app.use(express.json()); // For parsing JSON data
app.use(express.urlencoded({ extended: true })); // For parsing form data
app.use(flash()); // Flash messages

// Setting up EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files (CSS, images, JS)
app.use(express.static(path.join(__dirname, 'public')));

// MySQL Session Store Setup
const sessionStore = new MySQLStore({
    createDatabaseTable: false, // Since the table already exists
    schema: {
        tableName: 'express_sessions', // Explicitly tell it to use 'express_sessions'
        columnNames: {
            session_id: 'session_id',
            expires: 'expires',
            data: 'data'
        }
    }
}, db);

// Session middleware
app.use(
    session({
        key: 'tempest_sid',
        secret: 'your_secret_key', // Use a secure, random secret key
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 1000 * 60 * 60 * 24, // 1 day cookie expiration
        },
    })
);
app.use((req, res, next) => {
    res.locals.username = req.session.username || null;
    res.locals.userId = req.session.userId || null;
    res.locals.role = req.session.role || null;
    next();
});

app.use((req, res, next) => {
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
});

// Use routes
app.use('/', authRoutes); // Authentication routes for login, register, logout
app.use('/', indexRoutes); // General routes for home, roster, bank, etc.
app.use('/profile', profileRoutes); // Profile routes for viewing/editing user profiles
app.use('*', errorRoutes); // 404 page

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});

