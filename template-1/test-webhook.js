// Test script to demonstrate webhook functionality
import fetch from 'node-fetch';

const WEBHOOK_BASE_URL = 'http://localhost:3001';

async function testWebhook() {
  console.log('🧪 Testing Webhook Functionality\n');
  
  const webhookUrl = `${WEBHOOK_BASE_URL}/webhook/customer-data`;
  
  console.log(`📡 Webhook URL: ${webhookUrl}\n`);
  
  try {
    // Test 1: POST Request with n8n customer data
    console.log('1️⃣ Testing POST Request with customer data...');
    
    // Send the customer data in new n8n format
    const postData = [
      {
        output: {
          customer_name: "Manali Sharma",
          customer_id: 7818727325739,
          email: "manali.sharma@e2msolutions.com",
          date_time: "2025-10-03T13:06:21-05:00",
          subscriptions: [
            {
              id: "698319426",
              recipient_name: "Manali",
              current_address: {
                address1: "742 Evergreen Terrace, Suite 12A",
                city: "Springfield",
                province: "California",
                zip: "90210",
                country_code: "US"
              }
            },
            {
              id: "698319427",
              recipient_name: "Shubham",
              current_address: {
                address1: "456 Oak Avenue, Suite 12",
                city: "Chicago",
                province: "Illinois",
                zip: "60616",
                country_code: "US"
              }
            }
          ]
        }
      }
    ];
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(postData)
    });
    const responseData = await response.json();
    console.log('✅ Customer Data Response:', responseData);
    console.log('');
    
    // Test 2: Check webhook data
    console.log('2️⃣ Checking stored webhook data...');
    const dataResponse = await fetch(`${WEBHOOK_BASE_URL}/api/webhook-data`);
    const webhookData = await dataResponse.json();
    console.log(`✅ Found ${webhookData.count} webhook entries`);
    console.log('');
    
    // Test 3: Health check
    console.log('3️⃣ Testing health endpoint...');
    const healthResponse = await fetch(`${WEBHOOK_BASE_URL}/health`);
    const healthData = await healthResponse.json();
    console.log('✅ Health check:', healthData);
    console.log('');
    
    console.log('🎉 All tests completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Open your React app at http://localhost:5173');
    console.log('2. Click "Show Webhook Panel" button');
    console.log('3. You should see the test data in the webhook panel');
    console.log('4. Use the webhook URL in your n8n workflow');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure the webhook server is running: npm run webhook');
    console.log('2. Check if port 3001 is available');
    console.log('3. Install dependencies: npm install');
  }
}

// Run the test
testWebhook();
