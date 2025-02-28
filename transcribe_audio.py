import sys
import os
import wave
import subprocess
from vosk import Model, KaldiRecognizer
from pydub import AudioSegment  # Install with: pip install pydub

# Ensure ffmpeg is installed and in PATH
FFMPEG_PATH = "ffmpeg"  # Change this if ffmpeg is not in PATH

def convert_to_mono(input_path):
    output_path = input_path.replace(".wav", "_mono.wav")
    audio = AudioSegment.from_wav(input_path)
    audio = audio.set_channels(1)  # Convert to mono
    audio.export(output_path, format="wav")
    return output_path

def transcribe_audio(file_path):
    # Convert to mono if necessary
    with wave.open(file_path, "rb") as wf:
        if wf.getnchannels() != 1:
            print(f"Converting {file_path} to mono...")
            file_path = convert_to_mono(file_path)

    model_path = os.path.join(os.path.dirname(__file__), "vosk-model-en-us-0.22")
    if not os.path.exists(model_path):
        print("Model not found! Make sure 'vosk-model-en-us-0.22' is in the script directory.")
        return

    model = Model(model_path)
    recognizer = KaldiRecognizer(model, wf.getframerate())

    with wave.open(file_path, "rb") as wf:
        while True:
            data = wf.readframes(4000)
            if len(data) == 0:
                break
            recognizer.AcceptWaveform(data)

    print("Transcription Output:", recognizer.Result())

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python transcribe_audio.py <audio_file>")
    else:
        transcribe_audio(sys.argv[1])
