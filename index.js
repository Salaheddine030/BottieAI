import { createClient } from '@supabase/supabase-js';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';

// Supabase connection
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Store active bot clients
const activeBots = new Map();

// Available module commands
const moduleCommands = {
  moderation: [
    new SlashCommandBuilder().setName('kick').setDescription('Kick a user').addUserOption(o => o.setName('user').setDescription('User to kick').setRequired(true)),
    new SlashCommandBuilder().setName('ban').setDescription('Ban a user').addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true)),
    new SlashCommandBuilder().setName('mute').setDescription('Mute a user').addUserOption(o => o.setName('user').setDescription('User to mute').setRequired(true)),
  ],
  welcome: [
    new SlashCommandBuilder().setName('setwelcome').setDescription('Set welcome channel').addChannelOption(o => o.setName('channel').setDescription('Welcome channel').setRequired(true)),
  ],
  tickets: [
    new SlashCommandBuilder().setName('ticket').setDescription('Create a support ticket'),
    new SlashCommandBuilder().setName('closeticket').setDescription('Close current ticket'),
  ],
  leveling: [
    new SlashCommandBuilder().setName('rank').setDescription('Check your rank'),
    new SlashCommandBuilder().setName('leaderboard').setDescription('View server leaderboard'),
  ],
  music: [
    new SlashCommandBuilder().setName('play').setDescription('Play a song').addStringOption(o => o.setName('query').setDescription('Song name or URL').setRequired(true)),
    new SlashCommandBuilder().setName('stop').setDescription('Stop playing music'),
  ],
  giveaways: [
    new SlashCommandBuilder().setName('giveaway').setDescription('Start a giveaway').addStringOption(o => o.setName('prize').setDescription('Prize').setRequired(true)),
  ],
};

// Start a bot
async function startBot(botData) {
  if (activeBots.has(botData.id)) {
    console.log(`Bot ${botData.name} is already running`);
    return;
  }

  try {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
      ],
    });

    client.once('ready', async () => {
      console.log(`✅ Bot ${botData.name} is online as ${client.user.tag}`);
      
      // Update bot status in database
      await supabase.from('bots').update({
        status: 'online',
        servers: client.guilds.cache.size,
        client_id: client.user.id,
      }).eq('id', botData.id);

      // Register slash commands based on enabled modules
      await registerCommands(client, botData);
    });

    // Handle slash commands
    client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await handleCommand(interaction, botData);
    });

    // Handle new guild joins
    client.on('guildCreate', async () => {
      await supabase.from('bots').update({
        servers: client.guilds.cache.size,
      }).eq('id', botData.id);
    });

    await client.login(botData.token_encrypted);
    activeBots.set(botData.id, client);

  } catch (error) {
    console.error(`❌ Failed to start bot ${botData.name}:`, error.message);
    await supabase.from('bots').update({ status: 'error' }).eq('id', botData.id);
  }
}

// Stop a bot
async function stopBot(botId, botName) {
  const client = activeBots.get(botId);
  if (client) {
    client.destroy();
    activeBots.delete(botId);
    console.log(`🛑 Bot ${botName} stopped`);
    
    await supabase.from('bots').update({ status: 'offline' }).eq('id', botId);
  }
}

// Register slash commands for enabled modules
async function registerCommands(client, botData) {
  const commands = [];
  
  // Add commands for each enabled module
  for (const moduleId of botData.modules) {
    if (moduleCommands[moduleId]) {
      commands.push(...moduleCommands[moduleId].map(c => c.toJSON()));
    }
  }

  if (commands.length === 0) return;

  const rest = new REST({ version: '10' }).setToken(botData.token_encrypted);
  
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`📝 Registered ${commands.length} commands for ${botData.name}`);
    
    await supabase.from('bots').update({ commands: commands.length }).eq('id', botData.id);
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
}

// Handle slash commands
async function handleCommand(interaction, botData) {
  const { commandName } = interaction;

  // Moderation commands
  if (commandName === 'kick') {
    const user = interaction.options.getUser('user');
    await interaction.reply(`Kicked ${user.tag}!`);
  }
  else if (commandName === 'ban') {
    const user = interaction.options.getUser('user');
    await interaction.reply(`Banned ${user.tag}!`);
  }
  // Add more command handlers here...
  else {
    await interaction.reply(`Command ${commandName} executed!`);
  }
}

// Sync bots from database
async function syncBots() {
  console.log('🔄 Syncing bots from database...');
  
  const { data: bots, error } = await supabase
    .from('bots')
    .select('*');

  if (error) {
    console.error('Failed to fetch bots:', error);
    return;
  }

  for (const bot of bots) {
    if (bot.status === 'online' && !activeBots.has(bot.id)) {
      await startBot(bot);
    } else if (bot.status === 'offline' && activeBots.has(bot.id)) {
      await stopBot(bot.id, bot.name);
    }
  }
}

// Listen for realtime changes
function setupRealtimeListener() {
  supabase
    .channel('bots-changes')
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'bots' 
    }, async (payload) => {
      console.log('📡 Database change detected:', payload.eventType);
      
      if (payload.eventType === 'UPDATE') {
        const bot = payload.new;
        
        if (bot.status === 'online' && !activeBots.has(bot.id)) {
          await startBot(bot);
        } else if (bot.status === 'offline' && activeBots.has(bot.id)) {
          await stopBot(bot.id, bot.name);
        } else if (activeBots.has(bot.id)) {
          // Modules changed - restart bot to update commands
          await stopBot(bot.id, bot.name);
          if (bot.status === 'online') {
            await startBot(bot);
          }
        }
      } else if (payload.eventType === 'DELETE') {
        await stopBot(payload.old.id, payload.old.name);
      }
    })
    .subscribe();

  console.log('📡 Realtime listener active');
}

// Main
async function main() {
  console.log('🚀 Discord Bot Runner starting...');
  
  setupRealtimeListener();
  await syncBots();
  
  // Keep process alive
  setInterval(() => {
    console.log(`💓 Running ${activeBots.size} bot(s)`);
  }, 60000);
}

main().catch(console.error);
