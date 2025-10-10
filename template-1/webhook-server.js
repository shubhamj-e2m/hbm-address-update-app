import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the React app build directory
app.use(express.static(path.join(__dirname, 'dist')));

// Store webhook data in memory (in production, use a database)
let webhookData = [];

// Main webhook endpoint for n8n customer data
app.post('/webhook/customer-data', (req, res) => {
  const data = req.body;
  
  // Validate the expected n8n data structure
  // Handle both array format [{"output": {...}}] and direct object format
  let validData = null;
  
  if (Array.isArray(data) && data[0]?.output) {
    validData = data[0].output;
  } else if (data.customer_name || data.output?.customer_name) {
    validData = data.output || data;
  }
  
  if (!validData || !validData.customer_name || !validData.subscriptions) {
    return res.status(400).json({
      success: false,
      message: 'Invalid data format. Expected customer_name and subscriptions in output object.'
    });
  }
  
  // Create webhook entry
  const webhookEntry = {
    id: `webhook-${Date.now()}`,
    webhookId: 'customer-data',
    timestamp: new Date().toISOString(),
    method: 'POST',
    data,
    headers: req.headers,
    ip: req.ip || req.connection.remoteAddress
  };
  
  // Store the webhook data (replace existing customer data)
  webhookData = [webhookEntry];
  
  console.log('Customer data received from n8n:', data);
  
  // Send response
  res.status(200).json({
    success: true,
    message: 'Customer data received successfully',
    customer_name: validData.customer_name,
    customer_id: validData.customer_id,
    email: validData.email,
    subscriptions_count: validData.subscriptions.length,
    timestamp: webhookEntry.timestamp
  });
});

// Generic webhook endpoint for testing (backward compatibility)
app.all('/webhook/:webhookId', (req, res) => {
  const { webhookId } = req.params;
  const method = req.method;
  
  // Extract data based on method
  let data;
  if (method === 'GET') {
    data = req.query;
  } else if (method === 'POST') {
    data = req.body;
  }
  
  // Create webhook entry
  const webhookEntry = {
    id: `webhook-${Date.now()}`,
    webhookId,
    timestamp: new Date().toISOString(),
    method,
    data,
    headers: req.headers,
    ip: req.ip || req.connection.remoteAddress
  };
  
  // Store the webhook data
  webhookData.unshift(webhookEntry);
  
  // Keep only last 100 entries
  if (webhookData.length > 100) {
    webhookData = webhookData.slice(0, 100);
  }
  
  console.log(`Webhook received: ${method} /webhook/${webhookId}`, data);
  
  // Send response
  res.status(200).json({
    success: true,
    message: 'Webhook data received successfully',
    webhookId,
    timestamp: webhookEntry.timestamp,
    method,
    dataReceived: data
  });
});

// Endpoint to get all webhook data
app.get('/api/webhook-data', (req, res) => {
  res.json({
    success: true,
    data: webhookData,
    count: webhookData.length
  });
});

// Endpoint to clear webhook data
app.delete('/api/webhook-data', (req, res) => {
  webhookData = [];
  res.json({
    success: true,
    message: 'Webhook data cleared'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Serve React app for all other routes (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook/{webhookId}`);
  console.log(`API endpoint: http://localhost:${PORT}/api/webhook-data`);
});

export default app;
