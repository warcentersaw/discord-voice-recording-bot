const fs = require('fs');
const { spawn } = require('child_process');
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');

const tokenData = JSON.parse(fs.readFileSync('./token.json', 'utf8'));
const token = tokenData.token;
const clientId = tokenData.client_id;

if (!token || !clientId) {
    console.error("Error: Missing bot token or client ID in token.json.");
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let recordingTarget = null;
let connection = null;
let activeRecording = null;
let transcriptionQueue = [];
let isTranscribing = false;

const bannedWords = [
    "skull", "brainrot", "ratio", "mid", "based", "cringe", "cope", "seethe", "mald",
    "bozo", "l", "touch grass", "npc", "sigma", "gyatt", "rizz", "goofy", "delulu",
    "fanum tax", "nah", "yeat", "sus", "brokie", "lowkey", "highkey", "simp", "opinion discarded",
    "zoomies", "ok boomer", "gaslight", "gatekeep", "bussin", "valid", "chad", "fumbled", "clapped",
    "vibe check", "yeet", "drip", "based af", "literally me", "edgelord", "smh", "lmfao", "oof",
    "twitter moment", "hot take", "degen", "mid af", "ratioed", "cry about it", "brain dead", "moment",
    "your mom", "chat"
];

const commands = [
    {
        name: 'record',
        description: 'Start recording a specific user',
        options: [
            {
                name: 'target',
                type: 6,
                description: 'The user to record',
                required: true
            }
        ]
    },
    {
        name: 'stoprecord',
        description: 'Stop recording'
    }
];

const rest = new REST({ version: '10' }).setToken(token);
(async () => {
    try {
        console.log(`Registering slash commands for client ID: ${clientId}`);
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('Slash commands registered.');
    } catch (error) {
        console.error("Failed to register slash commands:", error);
    }
})();

client.once('ready', () => {
    console.log('Bot is online.');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'record') {
        const targetUser = interaction.options.getUser('target');
        const targetMember = interaction.guild.members.cache.get(targetUser.id);

        if (!targetUser || !targetMember || !targetMember.voice.channel) {
            return interaction.reply({ content: 'Target user is not in a voice channel.', ephemeral: true });
        }

        if (recordingTarget === targetUser.id) {
            return interaction.reply({ content: `${targetUser.username} is already being recorded.`, ephemeral: true });
        }

        stopRecording();

        recordingTarget = targetUser.id;
        connection = joinVoiceChannel({
            channelId: targetMember.voice.channel.id,
            guildId: interaction.guild.id,
            adapterCreator: interaction.guild.voiceAdapterCreator,
        });

        await interaction.reply({ content: 'Started recording.', ephemeral: false });

        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log(`Connected to ${targetUser.username}'s voice channel.`);
            startRecording(targetUser.id, interaction.guild);
        });
    } 
    
    else if (commandName === 'stoprecord') {
        stopRecording();
        interaction.reply({ content: 'Stopped recording.', ephemeral: false });
    }
});

function startRecording(userId, guild) {
    if (!userId || !connection) return;

    if (activeRecording) {
        console.log(`Already recording ${userId}, skipping duplicate.`);
        return;
    }

    const audio = connection.receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 700 },
    });

    const pcm = audio.pipe(new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 }));

    const timestamp = Date.now();
    const pcmFilePath = `./recordings/user${userId}-${timestamp}.pcm`;
    const writeStream = fs.createWriteStream(pcmFilePath);

    pcm.pipe(writeStream);
    activeRecording = writeStream;

    writeStream.on('finish', () => {
        console.log(`Recording saved to ${pcmFilePath}`);

        fs.stat(pcmFilePath, (err, stats) => {
            if (err || stats.size < 100) {
                fs.unlink(pcmFilePath, () => {});
            } else {
                convertToWav(pcmFilePath, userId, timestamp, guild);
            }
        });

        activeRecording = null;
        startRecording(userId, guild);
    });
}

function convertToWav(pcmPath, userId, timestamp, guild) {
    const wavPath = pcmPath.replace('.pcm', `.wav`);

    const pcmToWavProcess = spawn('ffmpeg', ['-f', 's16le', '-ar', '48000', '-ac', '2', '-i', pcmPath, wavPath]);

    pcmToWavProcess.on('close', (code) => {
        if (code === 0) {
            fs.unlink(pcmPath, () => {});
            transcriptionQueue.push({ wavPath, userId, guild });
            processQueue();
        } else {
            console.error(`Error converting PCM to WAV: ${code}`);
        }
    });
}

function processQueue() {
    if (isTranscribing || transcriptionQueue.length === 0) return;

    isTranscribing = true;
    const { wavPath, userId, guild } = transcriptionQueue.shift();

    transcribeAudio(wavPath, userId, guild, () => {
        fs.unlink(wavPath, () => {});
        isTranscribing = false;
        processQueue();
    });
}

function transcribeAudio(wavPath, userId, interaction, guild) {
    const pythonProcess = spawn('python', ['transcribe_audio.py', wavPath]);

    pythonProcess.stdout.on('data', (data) => {
        const transcription = data.toString().trim();
        console.log(`Transcription Output: ${transcription}`);

        const containsBannedWords = bannedWords.some(word => transcription.toLowerCase().includes(word.toLowerCase()));

        if (containsBannedWords) {
            console.log(`Detected banned words in transcription: "${transcription}"`);

            const user = guild.members.cache.get(userId);
            if (user) {
                console.log(`Attempting to kick user: ${user.user.username} (${user.id})`);

                user.kick("Detected use of banned words.")
                    .then(() => console.log(`Successfully kicked user: ${user.user.username} (${user.id})`))
                    .catch(err => console.error(`Failed to kick user: ${user.user.username} (${user.id})`, err));
            } else {
                console.error(`User with ID ${userId} not found in guild.`);
            }
        }
    });

    pythonProcess.on('close', (code) => {
        if (code === 0) {
            console.log(`Finished transcription for ${wavPath}`);
        } else {
            console.error(`Transcription failed for ${wavPath} with exit code ${code}`);
        }

        // Delete both WAV and mono WAV files
        deleteFile(wavPath);
        const monoWavPath = wavPath.replace('.wav', '_mono.wav');
        deleteFile(monoWavPath);

        startRecording(userId, interaction, guild);
    });
}

// Function to delete files
function deleteFile(filePath) {
    fs.unlink(filePath, (err) => {
        if (err) {
            console.error(`Error deleting file ${filePath}:`, err);
        } else {
            console.log(`Deleted file: ${filePath}`);
        }
    });
}


function stopRecording() {
    if (connection) {
        connection.destroy();
        connection = null;
    }

    if (activeRecording) {
        activeRecording.end();
        activeRecording = null;
    }

    recordingTarget = null;
}

client.login(token);
