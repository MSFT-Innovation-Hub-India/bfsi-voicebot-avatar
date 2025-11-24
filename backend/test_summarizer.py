"""Test script to debug the summarizer"""
from summarizer import generate_summary

# Sample test transcript
test_transcript = """Customer: Hi, I need help with my loan application.

Agent: Of course! I can help with that. Could you please provide your registered phone number or account number so I can access your loan details?

Customer: My phone number is 555-1234.

Agent: Thank you! I can see you're eligible for two credit card options. Based on your interest in cashback, I recommend the Cashback Plus Card. It offers great rewards on fuel and groceries.

Customer: That sounds good. What's the annual fee?

Agent: The annual fee is $99, but it's waived if you spend over $10,000 in the first year.

Customer: Okay, what documents do I need?

Agent: You'll need your ID, proof of income, and address proof. I can send you a link to upload these through the mobile app.

Customer: Perfect, thank you!

Agent: You're welcome! I've sent the link to your registered mobile number. Your application will be processed within 2-3 working days.
"""

print("=" * 80)
print("TESTING SUMMARIZER")
print("=" * 80)
print("\nTest Transcript:")
print("-" * 80)
print(test_transcript)
print("-" * 80)

print("\nGenerating summary...")
print("=" * 80)

try:
    summary = generate_summary(test_transcript)
    print("\n✓ SUCCESS! Summary generated:")
    print("=" * 80)
    print(summary)
    print("=" * 80)
except Exception as e:
    print(f"\n✗ ERROR: {e}")
    import traceback
    traceback.print_exc()
