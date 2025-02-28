import wave
import subprocess
import sys

def convert_pcm_to_wav(pcm_path, wav_path):
    """Converts PCM file to WAV format."""
    try:
        # Read the PCM file
        with open(pcm_path, 'rb') as pcm_file:
            pcm_data = pcm_file.read()

        # Open a WAV file for writing
        with wave.open(wav_path, 'wb') as wav_file:
            wav_file.setnchannels(2)  # Stereo audio
            wav_file.setsampwidth(2)  # 16-bit audio
            wav_file.setframerate(48000)  # Sampling rate
            wav_file.writeframes(pcm_data)

        print(f"Conversion successful! WAV saved at {wav_path}")
    except Exception as e:
        print(f"An error occurred while converting PCM to WAV: {e}")

if __name__ == "__main__":
    # Get the PCM and WAV paths from command-line arguments
    pcm_path = sys.argv[1]  # PCM file path
    wav_path = sys.argv[2]  # WAV file path

    # Convert the PCM file to WAV
    convert_pcm_to_wav(pcm_path, wav_path)
