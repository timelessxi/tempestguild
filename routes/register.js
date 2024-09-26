const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../config/db');  // Assuming you have a db config setup

// Registration Route (POST)
router.post('/register', async (req, res) => {
    const { username, email, password, confirmPassword } = req.body;

    // Validate input
    if (!username || !email || !password || !confirmPassword) {
        return res.status(400).send('All fields are required.');
    }
    if (password !== confirmPassword) {
        return res.status(400).send('Passwords do not match.');
    }

    try {
        // Check if the email or username already exists
        const [existingUser] = await db.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existingUser.length > 0) {
            return res.status(400).send('Username or Email already exists.');
        }

        // Hash the password
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Insert new user into the database with a pending status
        await db.query('INSERT INTO users (username, email, password, status) VALUES (?, ?, ?, ?)', 
                       [username, email, hashedPassword, 'pending']);

        // Redirect to a pending approval page after successful registration
        res.redirect('/register/pending');
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Registration Page (GET)
router.get('/register', (req, res) => {
    res.render('base', { title: 'Register - Tempest Guild', page: 'register' });
});

// Pending Approval Page (GET)
router.get('/register/pending', (req, res) => {
    res.render('base', { title: 'Registration Pending Approval', page: 'pending_approval' });
});

module.exports = router;
