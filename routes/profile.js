const express = require('express');
const router = express.Router();
const db = require('../config/db');

// View user profile
router.get('/:id', async (req, res) => {
    const userId = req.params.id;

    try {
        // Fetch user data and their characters from the database
        const [user] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
        const [characters] = await db.query('SELECT * FROM characters WHERE user_id = ?', [userId]);
        const [professions] = await db.query(`
            SELECT cp.profession_level, p.name 
            FROM character_professions cp
            JOIN professions p ON cp.profession_id = p.id
            WHERE cp.character_id IN (SELECT id FROM characters WHERE user_id = ?)
        `, [userId]);

        if (!user || user.length === 0) {
            return res.status(404).send('User not found');
        }

        res.render('base', {
            title: `${user[0].username}'s Profile`,
            page: 'profile',
            user: user[0],
            characters,
            professions
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Edit user profile
router.get('/:id/edit', async (req, res) => {
    const userId = req.params.id;

    try {
        const [user] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);

        if (!user || user.length === 0) {
            return res.status(404).send('User not found');
        }

        res.render('base', { title: 'Edit Profile', page: 'edit_profile', user: user[0] });
    } catch (error) {
        console.error('Error fetching user data for edit:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Update user profile
router.post('/:id/edit', async (req, res) => {
    const userId = req.params.id;
    const { username, email, bio } = req.body;

    try {
        await db.query('UPDATE users SET username = ?, email = ?, bio = ? WHERE id = ?', [username, email, bio, userId]);
        res.redirect(`/user/${userId}`);
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
