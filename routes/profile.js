const express = require('express');
const router = express.Router();
const db = require('../config/db');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Import the isAuthenticated middleware
const { isAuthenticated } = require('./middleware');


// View user profile
router.get('/:id', async (req, res) => {
    const userId = req.params.id;

    try {
        // Fetch user data and their characters from the database
        const [user] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
        const [characters] = await db.query('SELECT * FROM characters WHERE user_id = ?', [userId]);
        const [professions] = await db.query(`
            SELECT cp.profession_level, p.name, cp.character_id 
            FROM character_professions cp
            JOIN professions p ON cp.profession_id = p.id
            WHERE cp.character_id IN (SELECT id FROM characters WHERE user_id = ?)
        `, [userId]);
        // Fetch the list of available professions
        const [availableProfessions] = await db.query('SELECT * FROM professions');
        const [loggedInUserRole] = await db.query(`
            SELECT r.name 
            FROM users u 
            JOIN roles r ON u.role_id = r.id 
            WHERE u.id = ?
        `, [req.session.userId]);
        if (!user || user.length === 0) {
            return res.status(404).send('User not found');
        }

        // Pass the logged-in user's ID to the template
        res.render('base', {
            title: `${user[0].username}'s Profile`,
            page: 'profile',
            user: user[0],
            characters,
            professions,
            availableProfessions,  // Pass available professions to the template
            loggedInUserId: req.session.userId, // Pass the session userId
            loggedInUserRole: loggedInUserRole[0].name, // Pass the logged-in user's role to the template
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).send('Internal Server Error');
    }
});


router.post('/:id/update-profession', async (req, res) => {
    const userId = req.params.id;
    const { character_id, profession_id, profession_level } = req.body;

    if (profession_level < 1 || profession_level > 300) {
        return res.status(400).send('Profession level must be between 1 and 300');
    }

    try {
        // Check if the profession already exists for the character
        const [existingProfession] = await db.query(
            'SELECT * FROM character_professions WHERE character_id = ? AND profession_id = ?',
            [character_id, profession_id]
        );

        if (existingProfession.length > 0) {
            // Update the profession level if it exists
            await db.query('UPDATE character_professions SET profession_level = ? WHERE character_id = ? AND profession_id = ?',
                [profession_level, character_id, profession_id]);
        } else {
            // Insert new profession if it does not exist
            await db.query('INSERT INTO character_professions (character_id, profession_id, profession_level) VALUES (?, ?, ?)',
                [character_id, profession_id, profession_level]);
        }

        res.redirect(`/profile/${userId}`);
    } catch (error) {
        console.error('Error updating profession:', error);
        res.status(500).send('Internal Server Error');
    }
});

// GET route to display the edit profile form
router.get('/:id/edit', async (req, res) => {
    const userId = req.params.id;

    try {
        // Fetch user data from the database
        const [user] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);

        if (!user || user.length === 0) {
            return res.status(404).send('User not found');
        }

        // Ensure only the logged-in user can edit their own profile
        if (req.session.userId !== parseInt(userId)) {
            return res.status(403).send('You are not authorized to edit this profile.');
        }

        // Render the edit profile form
        res.render('base', { page: 'editProfile', title: 'Edit Profile', user: user[0], loggedInUserId: req.session.userId });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).send('Internal Server Error');
    }
});

// POST route to handle the form submission and update the profile
router.post('/:id/edit', async (req, res) => {
    const userId = req.params.id;
    const { email, bio } = req.body;

    try {
        // Ensure only the logged-in user can update their own profile
        if (req.session.userId !== parseInt(userId)) {
            return res.status(403).send('You are not authorized to update this profile.');
        }

        // Update the user's email and bio in the database
        await db.query('UPDATE users SET email = ?, bio = ? WHERE id = ?', [email, bio, userId]);

        // Redirect back to the user profile after successful update
        res.redirect(`/profile/${userId}`);
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).send('Internal Server Error');
    }
});

// POST route to set the main character
router.post('/:id/set-main-character', async (req, res) => {
    const userId = req.params.id;
    const { character_id } = req.body;

    try {
        // Ensure only the logged-in user can update their own profile
        if (req.session.userId !== parseInt(userId)) {
            return res.status(403).send('You are not authorized to update this profile.');
        }

        // Verify that the character belongs to the user
        const [characterResult] = await db.query(
            'SELECT * FROM characters WHERE id = ? AND user_id = ?',
            [character_id, userId]
        );

        const character = characterResult[0];

        if (!character) {
            return res.status(400).send('Invalid character selection.');
        }

        // Update the user's main_character field
        await db.query('UPDATE users SET main_character = ? WHERE id = ?', [character.name, userId]);

        // Redirect back to the profile page
        res.redirect(`/profile/${userId}`);
    } catch (error) {
        console.error('Error setting main character:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Define storage strategy for multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/profiles'); // Make sure this directory exists
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname); // Generate unique filenames
    }
});

const upload = multer({ storage: storage });

// Route to handle profile image upload
router.post('/:id/upload-image', upload.single('profileImage'), async (req, res) => {
    const userId = req.params.id;

    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const newImagePath = '/uploads/profiles/' + req.file.filename;

    try {
        // Fetch the current user's profile image from the database
        const [user] = await db.query('SELECT profile_image FROM users WHERE id = ?', [userId]);

        if (!user || user.length === 0) {
            return res.status(404).send('User not found');
        }

        // If the user has a profile image and it's not the default image, delete the old one
        const oldImagePath = user[0].profile_image;
        if (oldImagePath && oldImagePath !== '/images/default-profile.png') {
            const fullOldImagePath = path.join(__dirname, '../public', oldImagePath);

            // Check if file exists before attempting to delete
            if (fs.existsSync(fullOldImagePath)) {
                fs.unlink(fullOldImagePath, (err) => {
                    if (err) {
                        console.error('Error deleting old image:', err);
                    } else {
                        console.log('Old image deleted successfully');
                    }
                });
            }
        }

        // Update user's profile image path in the database
        await db.query('UPDATE users SET profile_image = ? WHERE id = ?', [newImagePath, userId]);

        // Redirect back to the profile page after successful upload
        res.redirect(`/profile/${userId}`);
    } catch (error) {
        console.error('Error updating profile image:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/:characterId/unclaim-character', isAuthenticated, async (req, res) => {
    const characterId = req.params.characterId;

    try {
        // Fetch the user_id of the current profile
        const [user] = await db.query('SELECT user_id FROM characters WHERE id = ?', [characterId]);
        // Set user_id to NULL and status to 'unclaimed' for the given character
        await db.query('UPDATE characters SET user_id = NULL, status = ? WHERE id = ?', ['unclaimed', characterId]);
        
        req.flash('success', 'Character unclaimed successfully!');
        res.redirect(`/profile/${user[0].user_id}`);
    } catch (error) {
        console.error('Error unclaiming character:', error);
        req.flash('error', 'An error occurred while unclaiming the character.');
        res.redirect(`/profile/${user[0].user_id}`);
    }
});

module.exports = router;
