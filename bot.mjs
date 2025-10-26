import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';

const API = process.env.API_URL || `http://localhost:${process.env.PORT || 8787}`;
const UI  = process.env.UI_URL || `http://localhost:${process.env.PORT || 8787}`;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, c => console.log(`Logged in as ${c.user.tag}`));

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;
  if (i.commandName !== 'dock') return;

  const pdbA = i.options.getString('pdb_a') || null;
  const pdbB = i.options.getString('pdb_b') || null;

  await i.deferReply();

  const payload = {
    pdbA, pdbB,
    params: {
      samples: 6000, maxTrans: 12, contactCut: 4.8,
      clashFactor: 0.85, wContact: 1.0, wClash: 6.0, soft: 0.5,
      topN: 8, seed: 42, atomMode: 'HEAVY', rescoreMode: 'NONE',
      pairMode: 'AGG', dupAngle: 12, dupTrans: 2
    }
  };

  try {
    const r = await fetch(`${API}/dock`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(`API error ${r.status}`);
    const { jobId } = await r.json();
    const link = `${UI}/index.html?job=${encodeURIComponent(jobId)}`;
    await i.editReply(`🚀 Docking started. Open the viewer here:\n${link}`);
  } catch (e) {
    await i.editReply(`Failed to start docking: ${e?.message || e}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
