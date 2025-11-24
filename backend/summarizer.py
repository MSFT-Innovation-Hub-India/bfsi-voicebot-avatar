# pip install azure-ai-projects==1.0.0b10
from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential
import logging

logger = logging.getLogger(__name__)

SUMMARIZER_INSTRUCTIONS = """You are a Call Summary Assistant. Your role is to read the full call transcript between the customer and the agent and produce a concise, professional, and well-structured summary.

Style & Tone Requirements:
- Write in clear, formal, business-appropriate language.
- Keep the summary concise and avoid unnecessary words.
- Maintain a neutral and objective tone.
- Do not use bullet points, emojis, hashtags, asterisks, or decorative symbols.
- Do not include filler dialogue, greetings, or direct quotes. Focus on meaning only.

Your output must contain **two parts** in the order below:

A) Short Summary (approximately 150 words):
Provide a brief narrative summary of the call, capturing the overall purpose, key points discussed, and general tone. This section should read as a smooth, cohesive paragraph.

B) Structured Summary:
Organize the call details under the following labeled sections:

1. Customer Intent:
State the primary reason the customer contacted support.

2. Customer Behavior:
Describe how the customer communicated (e.g., calm, frustrated, cooperative, concerned).

3. Overall Sentiment:
Summarize the emotional tone of the call (e.g., neutral, positive, negative, concerned, satisfied).

4. Key Details Discussed:
Summarize the essential information exchanged during the call.

5. Agent Actions:
Describe the steps taken by the agent and any guidance or clarification provided.

6. Resolution / Outcome:
Explain what was achieved or confirmed during the call.

7. Next Steps:
State any follow-up actions required from either the customer or the agent.

Additional Requirements:
- Use precise and economical wording.
- Avoid long or repetitive sentences.
- The output should read like a professional call log written by a human.

"""

def generate_summary(transcript: str) -> str:
    """
    Generate a professional call summary from the transcript
    
    Args:
        transcript: Full conversation transcript between user and agent
        
    Returns:
        Professional call summary following the specified format
    """
    # Initialize the project client
    project_client = AIProjectClient.from_connection_string(
        credential=DefaultAzureCredential(),
        conn_str="eastus2.api.azureml.ms;aee23923-3bba-468d-8dcd-7c4bc1ce218f;rg-ronakofficial1414-9323_ai;ronakofficial1414-8644")

    # Get the agent
    agent = project_client.agents.get_agent("asst_RGMNJ50yqPIDTVRupjK47jeW")
    
    # Create a conversation thread
    thread = project_client.agents.create_thread()
    
    # Send the transcript to the agent with instructions
    message = project_client.agents.create_message(
        thread_id=thread.id,
        role="user",
        content=f"{SUMMARIZER_INSTRUCTIONS}\n\nPlease summarize the following call transcript:\n\n{transcript}"
    )
    
    # Process the message and get response
    run = project_client.agents.create_and_process_run(
        thread_id=thread.id,
        agent_id=agent.id
    )
    
    # Get the summary
    messages = project_client.agents.list_messages(thread_id=thread.id)
    
    # Extract the assistant's response
    message_list = messages.data if hasattr(messages, 'data') else messages
    
    for msg in message_list:
        if msg.role == "assistant":
            # Get the text content from the message
            if msg.content:
                for content in msg.content:
                    if hasattr(content, 'text'):
                        return content.text.value
    
    return "Unable to generate summary."


def main():
    """Test the summarizer with sample input"""
    print("=" * 60)
    print("Call Summary Generator - Test Mode")
    print("=" * 60)
    print("Paste the call transcript below, then press Enter:\n")
    
    # Get transcript input
    lines = []
    print("Transcript (press Ctrl+D or Ctrl+Z when done):")
    try:
        while True:
            line = input()
            lines.append(line)
    except EOFError:
        pass
    
    transcript = "\n".join(lines)
    
    if transcript.strip():
        print("\n" + "=" * 60)
        print("Generating summary...")
        print("=" * 60 + "\n")
        
        try:
            summary = generate_summary(transcript)
            print(summary)
            print("\n" + "=" * 60)
        except Exception as e:
            print(f"Error: {e}")
    else:
        print("No transcript provided.")


if __name__ == "__main__":
    main()