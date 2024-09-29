const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../config/db');
const { moveCharacterToUser } = require('../utils/characterUtils');

// Login Page
router.get('/login', (req, res) => {
    res.render('base', { title: 'Login - Tempest Guild', page: 'login' });
});

router.get('/check-character', async (req, res) => {
    const { name } = req.query;

    try {
        // Check if the character exists in the characters table with 'unclaimed' status
        const [character] = await db.query('SELECT * FROM characters WHERE name = ? AND status = ?', [name, 'unclaimed']);
        if (character && character.length > 0) {
            return res.json({ exists: true });  // Character exists and is unclaimed
        } else {
            return res.json({ exists: false }); // Character not found or already claimed
        }
    } catch (error) {
        console.error('Error checking character:', error);
        res.status(500).json({ exists: false }); // Handle server error
    }
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

// Register Page
router.get('/register', (req, res) => {
    res.render('base', { title: 'Register - Tempest Guild', page: 'register' });
});

router.post('/register', async (req, res) => {
    const { username, password, confirmPassword, email, bio } = req.body;
    const character_name = req.body['character-name'];

    try {
        // Validate that passwords match
        if (password !== confirmPassword) {
            return res.status(400).send('Passwords do not match');
        }

        // Check if the user already exists
        const [existingUser] = await db.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existingUser.length > 0) {
            return res.status(400).send('Username or email already exists');
        }

        // Check if the character exists in the characters table with 'unclaimed' status
        const [character] = await db.query('SELECT * FROM characters WHERE name = ? AND status = ?', [character_name, 'unclaimed']);
        if (!character || character.length === 0) {
            return res.status(400).send('Character not found or already claimed');
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Insert the new user with 'pending' status
        const result = await db.query('INSERT INTO users (username, password, email, bio, status, main_character) VALUES (?, ?, ?, ?, ?, ?)', [
            username,
            hashedPassword,
            email,
            bio || null,
            'pending',
            character_name
        ]);

        const userId = result.insertId;  // Get the newly inserted user's ID

        res.render('base', { title: 'Registration Pending', page: 'pending_approval' });

    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.get('/logout', (req, res) => {
    if (req.session) {
        req.session.destroy((err) => {
            if (err) {
                console.error('Error logging out:', err);
                return res.status(500).send('Error logging out');
            }
            res.redirect('/');
        });
    } else {
        res.redirect('/');
    }
});

router.post('/claim-character', async (req, res) => {
    const { characterId } = req.body; // Use characterId instead of character_name
    const userId = req.session.userId;  // Get the logged-in user's ID from the session

    if (!userId) {
        return res.status(401).send('You must be logged in to claim a character');
    }

    try {
        // Fetch the character by ID and ensure it is unclaimed
        const [character] = await db.query('SELECT * FROM characters WHERE id = ? AND status = ?', [characterId, 'unclaimed']);
        if (!character || character.length === 0) {
            return res.status(400).send('Character not found or already claimed');
        }

        // Use the reusable function to move the character to the user
        const moveResult = await moveCharacterToUser(userId, character[0].name);
        if (!moveResult.success) {
            return res.status(400).send(moveResult.message); // Handle errors related to moving the character
        }

        res.redirect('/roster');
    } catch (error) {
        console.error('Error claiming character:', error);
        res.status(500).send('Internal Server Error');
    }
});


module.exports = router;
