const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../config/db'); // Make sure this points to your database configuration

// Login Page
router.get('/login', (req, res) => {
    res.render('base', { title: 'Login - Tempest Guild', page: 'login' });
});

// Handle Login Logic
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const [user] = await db.query('SELECT * FROM users WHERE username = ? AND status = ?', [username, 'approved']);

        if (!user || user.length === 0) {
            return res.status(401).send('Invalid login credentials');
        }

        console.log('User fetched:', user);

        // Check if the password matches the stored hash
        const isMatch = await bcrypt.compare(password, user[0].password);
        console.log('Password match:', isMatch);
        if (!isMatch) {
            return res.status(401).send('Invalid login credentials');
        }

        // Save the user ID in the session
        req.session.userId = user[0].id;
        req.session.username = user[0].username;
        req.session.role = user[0].role_id;

        res.redirect('/roster'); // Redirect to the guild roster after login
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Registration Page
router.get('/register', (req, res) => {
    res.render('base', { title: 'Register - Tempest Guild', page: 'register' });
});

// Handle Registration Logic
router.post('/register', async (req, res) => {
    const { username, password, email, bio } = req.body;

    try {
        // Check if the user already exists
        const [existingUser] = await db.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, email]);

        if (existingUser.length > 0) {
            return res.status(400).send('Username or email already exists');
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Insert the new user with 'pending' status
        await db.query('INSERT INTO users (username, password, email, bio, status) VALUES (?, ?, ?, ?, ?)', [
            username, 
            hashedPassword, 
            email, 
            bio || null, 
            'pending'
        ]);

        // Send them to a "registration pending" page
        res.render('base', { title: 'Registration Pending', page: 'pending_approval' });
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.get('/logout', (req, res) => {
    // Check if session exists
    if (req.session) {
        console.log('Logging out user:', req.session.username); // Log username before destroying session
        req.session.destroy((err) => {
            if (err) {
                console.error('Error logging out:', err);
                return res.status(500).send('Error logging out');
            } else {
                res.redirect('/');
            }
        });
    } else {
        console.log('No session found');
        res.redirect('/'); // Redirect even if no session exists
    }
});


module.exports = router;
