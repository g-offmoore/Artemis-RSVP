import 'dotenv/config';
import { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, } from 'discord.js';
import { SlashCommandBuilder } from '@discordjs/builders';
import axios from 'axios';
// Load and validate environment variables
const rawApiUrl = process.env.API_URL;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
if (!rawApiUrl || !DISCORD_TOKEN || !GUILD_ID) {
    console.error('Missing one of API_URL, DISCORD_TOKEN, GUILD_ID');
    process.exit(1);
}
// Ensure API_URL has protocol
const API_URL = rawApiUrl.match(/^https?:\/\//i) ? rawApiUrl : `http://${rawApiUrl}`;
// Axios instance for backend calls
const api = axios.create({
    baseURL: API_URL,
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
});
// Initialize Discord client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
// Register slash commands when ready
client.once('ready', async () => {
    console.log(`Logged in as ${client.user?.tag}`);
    const commands = [
        new SlashCommandBuilder()
            .setName('event')
            .setDescription('Manage events')
            .addSubcommand(sub => sub
            .setName('create')
            .setDescription('Create a new event')
            // required first
            .addStringOption(opt => opt.setName('name').setDescription('Event name').setRequired(true))
            .addStringOption(opt => opt.setName('start').setDescription('Start datetime (ISO)').setRequired(true))
            .addStringOption(opt => opt.setName('end').setDescription('End datetime (ISO)').setRequired(true))
            // optional next
            .addStringOption(opt => opt.setName('description').setDescription('Event description'))
            .addStringOption(opt => opt.setName('rrule').setDescription('Recurrence rule (optional)')))
            .addSubcommand(sub => sub.setName('list').setDescription('List upcoming events'))
            .addSubcommand(sub => sub
            .setName('delete')
            .setDescription('Delete an event')
            .addStringOption(opt => opt.setName('id').setDescription('Event ID').setRequired(true)))
            .toJSON(),
    ];
    await client.application?.commands.set(commands, GUILD_ID);
    console.log('Slash commands registered');
});
// Global error handlers
client.on('error', console.error);
client.on('shardError', console.error);
// Main interaction handler
client.on('interactionCreate', async (interaction) => {
    try {
        // Slash commands
        if (interaction.isChatInputCommand()) {
            const cmd = interaction;
            if (cmd.commandName === 'event') {
                const sub = cmd.options.getSubcommand();
                // CREATE
                if (sub === 'create') {
                    const payload = {
                        guildId: cmd.guildId,
                        channelId: cmd.channelId,
                        name: cmd.options.getString('name', true),
                        description: cmd.options.getString('description') || '',
                        startDate: cmd.options.getString('start', true),
                        endDate: cmd.options.getString('end', true),
                        rrule: cmd.options.getString('rrule') || undefined,
                    };
                    const { data: event } = await api.post('/events', payload);
                    const embed = new EmbedBuilder()
                        .setTitle(event.name)
                        .setDescription(event.description)
                        .addFields({ name: 'When', value: `${event.startDate} to ${event.endDate}` })
                        .setFooter({ text: `Event ID: ${event.id}` });
                    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`rsvp_${event.id}`).setLabel('✅ RSVP').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`add_guests_${event.id}`).setLabel('➕ Guests').setStyle(ButtonStyle.Primary));
                    // Public post
                    await cmd.reply({ embeds: [embed], components: [row] });
                    return;
                }
                // LIST
                if (sub === 'list') {
                    const { data: events } = await api.get('/events', { params: { guildId: cmd.guildId } });
                    if (!Array.isArray(events) || events.length === 0) {
                        await cmd.reply({ content: 'No upcoming events.', ephemeral: true });
                    }
                    else {
                        const list = events.map((e) => `• **${e.name}** (ID: ${e.id}) — ${e.startDate}`).join('\n');
                        await cmd.reply({ content: `Upcoming events:\n${list}`, ephemeral: true });
                    }
                    return;
                }
                // DELETE
                if (sub === 'delete') {
                    const id = cmd.options.getString('id', true);
                    await api.delete(`/events/${id}`);
                    await cmd.reply({ content: `Deleted event ${id}.`, ephemeral: true });
                    return;
                }
            }
        }
        // Button interactions
        if (interaction.isButton()) {
            const id = interaction.customId;
            // Show guests modal
            if (id.startsWith('add_guests_')) {
                const eventId = id.replace('add_guests_', '');
                const modal = new ModalBuilder()
                    .setCustomId(`add_guests_${eventId}`)
                    .setTitle('Add Your Guests')
                    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guestCount').setLabel('How many guests?').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guestNames').setLabel('Guest names (comma-separated or one per line)').setStyle(TextInputStyle.Paragraph)));
                await interaction.showModal(modal);
                return;
            }
            // Quick RSVP
            if (id.startsWith('rsvp_')) {
                const eventId = id.replace('rsvp_', '');
                try {
                    await api.post(`/events/${eventId}/rsvp`, { userId: interaction.user.id });
                    await interaction.reply({ content: '✅ You are now RSVPed!', ephemeral: true });
                }
                catch (err) {
                    console.error('RSVP error:', err.message);
                    const msg = err.code === 'ECONNREFUSED' ? 'Backend unreachable.' : 'Failed to RSVP.';
                    await interaction.reply({ content: msg, ephemeral: true });
                }
                return;
            }
        }
        // Modal submissions
        if (interaction.isModalSubmit() && interaction.customId.startsWith('add_guests_')) {
            const eventId = interaction.customId.replace('add_guests_', '');
            const guests = parseInt(interaction.fields.getTextInputValue('guestCount'), 10);
            const rawNames = interaction.fields.getTextInputValue('guestNames') || '';
            const guestNames = rawNames.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
            try {
                await api.patch(`/events/${eventId}/rsvp`, { userId: interaction.user.id, guests, guestNames });
                await interaction.reply({ content: '✅ RSVP updated!', ephemeral: true });
            }
            catch (err) {
                console.error('Add guests error:', err.message);
                const msg = err.code === 'ECONNREFUSED' ? 'Backend unreachable.' : 'Failed to record guests.';
                await interaction.reply({ content: msg, ephemeral: true });
            }
        }
    }
    catch (error) {
        console.error('Interaction handler error:', error);
        if (interaction.isRepliable()) {
            await interaction.reply({ content: '❌ Something went wrong.', ephemeral: true });
        }
    }
});
client.login(DISCORD_TOKEN).catch(err => {
    console.error('Login failed:', err);
    process.exit(1);
});
