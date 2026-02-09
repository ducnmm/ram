#!/usr/bin/env python3
"""Check OpenRouter API usage and credits"""

import os
import requests

OPENROUTER_API_KEY = os.environ.get('OPENROUTER_API_KEY')

if not OPENROUTER_API_KEY:
    print("❌ OPENROUTER_API_KEY not found in environment")
    exit(1)

print(f"🔑 Checking API key: {OPENROUTER_API_KEY[:20]}...")

# Check credits endpoint
url = "https://openrouter.ai/api/v1/auth/key"
headers = {
    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
}

try:
    response = requests.get(url, headers=headers)
    
    print(f"\n📊 Status Code: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        print(f"\n✅ API Key Info:")
        print(f"   Label: {data.get('data', {}).get('label', 'N/A')}")
        print(f"   Usage: ${data.get('data', {}).get('usage', 0):.4f}")
        print(f"   Limit: ${data.get('data', {}).get('limit', 'No limit')}")
        limit_remaining = data.get('data', {}).get('limit_remaining')
        if limit_remaining is not None:
            print(f"   Remaining: ${limit_remaining:.4f}")
    else:
        print(f"\n❌ Error Response:")
        print(response.text)
        
        # Try generation stats instead
        print("\n🔄 Trying generation stats...")
        gen_url = "https://openrouter.ai/api/v1/generation?limit=100"
        gen_response = requests.get(gen_url, headers=headers)
        
        if gen_response.status_code == 200:
            gen_data = gen_response.json()
            if 'data' in gen_data:
                total_cost = sum(float(item.get('total_cost', 0)) for item in gen_data['data'])
                print(f"✅ Total usage from last 100 generations: ${total_cost:.4f}")
                print(f"   Generations: {len(gen_data['data'])}")
        else:
            print(f"❌ Generation stats also failed: {gen_response.status_code}")
        
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
