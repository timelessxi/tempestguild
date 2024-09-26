const express = require('express');
const path = require('path');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const multer = require('multer');
const db = require('./config/db'); // Database configuration
const routes = require('./routes'); // Import routes
const app = express();
const PORT = process.env.PORT || 3000;
const sessionStore = new MySQLStore({
    schema: {
      tableName: 'express_sessions',  // Use the new table name
    },
  }, db.pool);
  
// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'your_secret_key',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
  }));

// Set up EJS as the view engine
app.set('view engine', 'ejs');

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Use routes
const profileRoutes = require('./routes/profile'); // Import profile routes

app.use('/', routes);
app.use('/user', profileRoutes); // Ensure that '/user' routes are in place
// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

