#!/bin/bash

# Wait for Ollama to be ready
echo "Waiting for Ollama to start..."
while ! curl -f http://localhost:11434/api/tags > /dev/null 2>&1; do
    sleep 5
done

echo "Ollama is ready. Pulling models..."

# Pull embedding model (already exists but ensures it's available)
ollama pull nomic-embed-text

# Pull additional models for text generation
ollama pull llama3.2:1b      # Lightweight text generation model
# ollama pull mistral:7b       # Good general-purpose model  
# ollama pull codellama:7b     # Code generation model
# ollama pull gemma2:2b        # Google's Gemma model

echo "All models pulled successfully!"
echo "Available models:"
ollama list