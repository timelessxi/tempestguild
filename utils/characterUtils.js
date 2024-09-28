const db = require('../config/db'); // Ensure this points to your database configuration

async function moveCharacterToUser(userId, characterName) {
    try {
        // Check if the character exists in the characters table with 'unclaimed' status
        const [character] = await db.query('SELECT * FROM characters WHERE name = ? AND status = ?', [characterName, 'unclaimed']);
        if (!character || character.length === 0) {
            return { success: false, message: 'Character not found or already claimed' };
        }

        // Update the character, linking it to the user and changing its status to 'claimed'
        await db.query('UPDATE characters SET user_id = ?, status = ? WHERE id = ?', [
            userId,
            'claimed',
            character[0].id
        ]);

        return { success: true, message: 'Character moved successfully' };

    } catch (error) {
        console.error('Error moving character:', error);
        return { success: false, message: 'Error occurred while moving character' };
    }
}

module.exports = { moveCharacterToUser };
