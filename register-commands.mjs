import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('dock')
    .setDescription('Dock two PDB structures on the backend and visualize in the web app')
    .addStringOption(o=>o.setName('pdb_a').setDescription('Antibody PDB text (optional: leave empty for demo)').setRequired(false))
    .addStringOption(o=>o.setName('pdb_b').setDescription('Antigen PDB text (optional: leave empty for demo)').setRequired(false))
].map(c=>c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
await rest.put(Routes.applicationCommands(process.env.APP_ID), { body: commands });
console.log('Slash commands registered.');
