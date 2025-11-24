"""
Real-time Sentiment Analysis Module using Transformer Models
Analyzes user transcriptions for sentiment and emotions
"""

import logging
from typing import Dict, Optional
import asyncio
from functools import lru_cache

logger = logging.getLogger(__name__)

# Global variables to store models (loaded once)
_sentiment_pipeline = None
_emotion_pipeline = None
_models_loaded = False


def load_models():
    """Load transformer models for sentiment and emotion analysis."""
    global _sentiment_pipeline, _emotion_pipeline, _models_loaded
    
    if _models_loaded:
        return
    
    try:
        from transformers import pipeline
        import warnings
        
        # Suppress transformers warnings about unused weights
        warnings.filterwarnings('ignore', message='Some weights of the model checkpoint')
        
        logger.info("Loading sentiment analysis models...")
        
        # Sentiment Classification Model
        # Using cardiffnlp/twitter-roberta-base-sentiment-latest
        # This model is excellent for conversational text and social media
        _sentiment_pipeline = pipeline(
            "sentiment-analysis",
            model="cardiffnlp/twitter-roberta-base-sentiment-latest",
            device=-1  # CPU, change to 0 for GPU
        )
        logger.info("✓ Sentiment model loaded: cardiffnlp/twitter-roberta-base-sentiment-latest")
        
        # Emotion Detection Model
        # Using j-hartmann/emotion-english-distilroberta-base
        # Detects: joy, sadness, anger, fear, surprise, love, neutral
        _emotion_pipeline = pipeline(
            "text-classification",
            model="j-hartmann/emotion-english-distilroberta-base",
            device=-1,  # CPU, change to 0 for GPU
            top_k=None  # Return all emotion scores
        )
        logger.info("✓ Emotion model loaded: j-hartmann/emotion-english-distilroberta-base")
        
        _models_loaded = True
        logger.info("🎯 Sentiment analysis models ready!")
        
    except Exception as e:
        logger.error(f"Failed to load sentiment models: {str(e)}")
        logger.error("Install required packages: pip install transformers torch")
        raise


async def analyze_sentiment(text: str) -> Dict[str, any]:
    """
    Analyze sentiment and emotions of the given text.
    
    Args:
        text: The text to analyze (user transcription)
    
    Returns:
        Dict containing sentiment, emotion, scores, and emoji
    """
    if not text or len(text.strip()) < 3:
        return {
            "sentiment": "neutral",
            "sentiment_score": 0.0,
            "emotion": "neutral",
            "emotion_score": 0.0,
            "emoji": "😐",
            "all_emotions": {}
        }
    
    try:
        # Ensure models are loaded
        if not _models_loaded:
            load_models()
        
        # Run analysis in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        
        # Analyze sentiment
        sentiment_result = await loop.run_in_executor(
            None, 
            lambda: _sentiment_pipeline(text[:512])[0]  # Limit to 512 chars
        )
        
        # Analyze emotions
        emotion_results = await loop.run_in_executor(
            None,
            lambda: _emotion_pipeline(text[:512])
        )
        
        # Process sentiment result
        sentiment_label = sentiment_result['label'].lower()
        sentiment_score = sentiment_result['score']
        
        # Map sentiment labels (model uses 'positive', 'negative', 'neutral')
        sentiment_map = {
            'positive': 'positive',
            'negative': 'negative',
            'neutral': 'neutral',
            'pos': 'positive',
            'neg': 'negative',
            'neu': 'neutral'
        }
        sentiment = sentiment_map.get(sentiment_label, 'neutral')
        
        # Process emotion results - get top emotion
        if emotion_results and len(emotion_results[0]) > 0:
            # Sort by score to get top emotion
            top_emotion = max(emotion_results[0], key=lambda x: x['score'])
            emotion_label = top_emotion['label'].lower()
            emotion_score = top_emotion['score']
            
            # Create dictionary of all emotions
            all_emotions = {
                e['label'].lower(): round(e['score'], 3) 
                for e in emotion_results[0]
            }
        else:
            emotion_label = 'neutral'
            emotion_score = 0.0
            all_emotions = {}
        
        # Map emotions to emojis
        emoji = get_emoji_for_emotion(emotion_label, sentiment)
        
        result = {
            "sentiment": sentiment,
            "sentiment_score": round(sentiment_score, 3),
            "emotion": emotion_label,
            "emotion_score": round(emotion_score, 3),
            "emoji": emoji,
            "all_emotions": all_emotions,
            "text_length": len(text)
        }
        
        logger.debug(f"Sentiment Analysis: {sentiment} ({sentiment_score:.2f}), Emotion: {emotion_label} ({emotion_score:.2f})")
        
        return result
        
    except Exception as e:
        logger.error(f"Sentiment analysis failed: {str(e)}")
        return {
            "sentiment": "neutral",
            "sentiment_score": 0.0,
            "emotion": "neutral",
            "emotion_score": 0.0,
            "emoji": "😐",
            "all_emotions": {},
            "error": str(e)
        }


def get_emoji_for_emotion(emotion: str, sentiment: str = "neutral") -> str:
    """Map emotion and sentiment to appropriate emoji."""
    
    # Emotion-specific emojis
    emotion_emojis = {
        'joy': '😊',
        'happiness': '😊',
        'happy': '😄',
        'love': '❤️',
        'admiration': '🥰',
        'excitement': '🎉',
        'amusement': '😄',
        'gratitude': '🙏',
        'optimism': '😌',
        
        'sadness': '😢',
        'sad': '😔',
        'disappointment': '😞',
        'grief': '😥',
        
        'anger': '😠',
        'angry': '😡',
        'annoyance': '😒',
        'frustration': '😤',
        
        'fear': '😨',
        'scared': '😰',
        'nervousness': '😬',
        'anxiety': '😟',
        
        'surprise': '😲',
        'surprised': '😮',
        'amazement': '😯',
        
        'disgust': '🤢',
        'contempt': '😤',
        
        'confusion': '🤔',
        'embarrassment': '😳',
        
        'neutral': '😐',
        'calm': '😌',
    }
    
    # Try emotion first
    if emotion in emotion_emojis:
        return emotion_emojis[emotion]
    
    # Fallback to sentiment
    sentiment_emojis = {
        'positive': '😊',
        'negative': '😟',
        'neutral': '😐'
    }
    
    return sentiment_emojis.get(sentiment, '😐')


def get_sentiment_color(sentiment: str) -> str:
    """Get color code for sentiment visualization."""
    colors = {
        'positive': '#22c55e',  # Green
        'negative': '#ef4444',  # Red
        'neutral': '#94a3b8'    # Gray
    }
    return colors.get(sentiment, '#94a3b8')


def get_emotion_color(emotion: str) -> str:
    """Get color code for emotion visualization."""
    colors = {
        'joy': '#fbbf24',      # Yellow
        'love': '#ec4899',     # Pink
        'surprise': '#8b5cf6', # Purple
        'sadness': '#3b82f6',  # Blue
        'anger': '#ef4444',    # Red
        'fear': '#f97316',     # Orange
        'disgust': '#84cc16',  # Lime
        'neutral': '#94a3b8'   # Gray
    }
    return colors.get(emotion, '#94a3b8')


# Pre-load models on module import (optional - can be done on first use)
def init_models_async():
    """Initialize models asynchronously in background."""
    try:
        import threading
        thread = threading.Thread(target=load_models, daemon=True)
        thread.start()
        logger.info("Started background model loading...")
    except Exception as e:
        logger.warning(f"Background model loading failed: {e}")


# Uncomment below to auto-load models on server start
# init_models_async()
