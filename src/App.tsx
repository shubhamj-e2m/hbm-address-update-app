import { useState, useCallback, useRef, useEffect } from 'react'
import './App.css'

// Webhook interface for incoming data from n8n
interface N8nWebhookData {
  customer_name: string;
  shopify_id: number;
  recharge_id: number;
  email: string;
  date_time: string;
  subscriptions: {
    id: string;
    recipient_name: string;
    current_address: {
      address1: string;
      city: string;
      province: string;
      zip: string;
      country_code: string;
    };
  }[];
}

interface Subscription {
  id: string;
  name: string;
  address: string;
}

interface AddressForm {
  selectedSubscriptions: string[];
  subscriptionAddresses: {
    [subscriptionId: string]: {
      street: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
    };
  };
}

function App() {
  const [formData, setFormData] = useState<AddressForm>({
    selectedSubscriptions: [],
    subscriptionAddresses: {}
  });
  const [addressSuggestions, setAddressSuggestions] = useState<{ [key: string]: string[] }>({});
  const [showSuggestions, setShowSuggestions] = useState<{ [key: string]: boolean }>({});
  const [showToast, setShowToast] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>('');

  // Customer and subscription data from webhook
  const [customerName, setCustomerName] = useState<string>('');
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [dataLoaded, setDataLoaded] = useState<boolean>(false);

  // Metadata from n8n (not displayed in UI, but sent back)
  const [customerMetadata, setCustomerMetadata] = useState<{
    shopify_id: number | null;
    recharge_id: number | null;
    email: string;
    date_time: string;
  }>({
    shopify_id: null,
    recharge_id: null,
    email: '',
    date_time: ''
  });

  // Debounce timer refs
  const debounceTimer = useRef<number | null>(null);
  const addressDebounceTimer = useRef<number | null>(null);

  // Function to normalize state to abbreviation
  const normalizeStateToAbbreviation = useCallback((state: string): string => {
    if (!state) return '';

    // If it's already an abbreviation (2 characters), return as is
    if (state.length === 2) {
      return state.toUpperCase();
    }

    // Map of full state names to abbreviations
    const stateMap: { [key: string]: string } = {
      'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
      'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
      'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
      'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
      'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
      'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
      'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
      'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
      'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
      'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY'
    };

    // Check if it's a full state name and convert to abbreviation
    const normalizedState = stateMap[state] || state.toUpperCase();
    return normalizedState;
  }, []);

  // Function to fetch state and city from zipcode using Zippopotam.us API
  const fetchLocationFromZipcode = useCallback(async (zipcode: string): Promise<{ state: string | null, city: string | null }> => {
    try {
      // Clean zipcode (remove spaces, non-numeric characters except for US format)
      const cleanZipcode = zipcode.replace(/\s+/g, '').replace(/[^\d-]/g, '');

      if (cleanZipcode.length < 5) {
        return { state: null, city: null };
      }

      const response = await fetch(`https://api.zippopotam.us/us/${cleanZipcode}`);

      if (!response.ok) {
        throw new Error('Failed to fetch zipcode data');
      }

      const data = await response.json();

      if (data.places && data.places.length > 0) {
        const place = data.places[0];
        return {
          state: place.state ? normalizeStateToAbbreviation(place.state) : null, // Returns state abbreviation (e.g., "IL", "CA")
          city: place['place name'] || null // Returns city name (e.g., "Springfield", "Chicago")
        };
      }

      return { state: null, city: null };
    } catch (error) {
      console.error('Error fetching location from zipcode:', error);
      return { state: null, city: null };
    }
  }, [normalizeStateToAbbreviation]);

  // Function to fetch address suggestions from OpenStreetMap Nominatim API
  const fetchAddressSuggestions = useCallback(async (query: string, city: string, state: string): Promise<string[]> => {
    try {
      if (!query || query.length < 3) {
        return [];
      }

      // Construct search query with city and state for better results
      const searchQuery = `${query}, ${city}, ${state}, USA`;
      const encodedQuery = encodeURIComponent(searchQuery);

      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodedQuery}&countrycodes=us&limit=5&addressdetails=1`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch address suggestions');
      }

      const data = await response.json();

      // Extract display names from the results
      const suggestions = data.map((item: any) => item.display_name).filter(Boolean);

      return suggestions;
    } catch (error) {
      console.error('Error fetching address suggestions:', error);
      return [];
    }
  }, []);

  // Debounced function to handle address input changes
  const handleAddressInputChange = useCallback((subscriptionId: string, address: string, city: string, state: string) => {
    // Clear existing timer
    if (addressDebounceTimer.current) {
      clearTimeout(addressDebounceTimer.current);
    }

    // Set new timer
    addressDebounceTimer.current = setTimeout(async () => {
      if (address.length >= 3 && city && state) {
        const suggestions = await fetchAddressSuggestions(address, city, state);
        setAddressSuggestions(prev => ({
          ...prev,
          [subscriptionId]: suggestions
        }));
        setShowSuggestions(prev => ({
          ...prev,
          [subscriptionId]: suggestions.length > 0
        }));
      } else {
        setShowSuggestions(prev => ({
          ...prev,
          [subscriptionId]: false
        }));
      }
    }, 300); // 300ms delay for address suggestions
  }, [fetchAddressSuggestions]);

  // Debounced function to handle zipcode changes
  const handleZipcodeChange = useCallback((subscriptionId: string, zipcode: string) => {
    // Clear existing timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Set new timer
    debounceTimer.current = setTimeout(async () => {
      if (zipcode.length >= 5) {
        const location = await fetchLocationFromZipcode(zipcode);
        if (location.state || location.city) {
          setFormData(prev => ({
            ...prev,
            subscriptionAddresses: {
              ...prev.subscriptionAddresses,
              [subscriptionId]: {
                ...prev.subscriptionAddresses[subscriptionId],
                ...(location.state && { state: location.state }),
                ...(location.city && { city: location.city })
              }
            }
          }));
        }
      }
    }, 500); // 500ms delay
  }, [fetchLocationFromZipcode]);

  // Function to handle address suggestion selection
  const handleSuggestionSelect = (subscriptionId: string, suggestion: string) => {
    // Extract just the street address part (before the first comma)
    const streetAddress = suggestion.split(',')[0].trim();

    setFormData(prev => ({
      ...prev,
      subscriptionAddresses: {
        ...prev.subscriptionAddresses,
        [subscriptionId]: {
          ...prev.subscriptionAddresses[subscriptionId],
          street: streetAddress
        }
      }
    }));

    // Hide suggestions
    setShowSuggestions(prev => ({
      ...prev,
      [subscriptionId]: false
    }));
  };

  // Function to hide suggestions when clicking outside
  const handleInputBlur = (subscriptionId: string) => {
    // Delay hiding to allow for suggestion clicks
    setTimeout(() => {
      setShowSuggestions(prev => ({
        ...prev,
        [subscriptionId]: false
      }));
    }, 200);
  };

  // Cleanup effect to clear debounce timers on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      if (addressDebounceTimer.current) {
        clearTimeout(addressDebounceTimer.current);
      }
    };
  }, []);

  // Load webhook data from server once (don't override user input)
  useEffect(() => {
    const loadWebhookData = async () => {
      // Only load data once to prevent overriding user input
      if (dataLoaded) return;

      try {
        const apiUrl = import.meta.env.PROD ? '/api/webhook-data' : 'https://hbm-address-update-app-production.up.railway.app/webhook/customer-data';
        const response = await fetch(apiUrl);
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data && result.data.length > 0) {
            // Get the latest webhook data
            const latestWebhookData = result.data[0];

            // Handle n8n data structure - direct object format
            let webhookPayload: N8nWebhookData | null = null;

            if (latestWebhookData.data) {
              // Check if data has the expected structure
              if (latestWebhookData.data.customer_name && latestWebhookData.data.shopify_id) {
                webhookPayload = latestWebhookData.data;
              }
            }

            if (webhookPayload) {
              // Set customer name
              setCustomerName(webhookPayload.customer_name);

              // Store metadata (not displayed in UI)
              setCustomerMetadata({
                shopify_id: webhookPayload.shopify_id || null,
                recharge_id: webhookPayload.recharge_id || null,
                email: webhookPayload.email || '',
                date_time: webhookPayload.date_time || ''
              });

              // Transform webhook subscriptions to our format
              const transformedSubscriptions: Subscription[] = webhookPayload.subscriptions.map(sub => ({
                id: sub.id,
                name: sub.recipient_name,
                address: `${sub.current_address.address1}\n${sub.current_address.city}, ${sub.current_address.province} ${sub.current_address.zip}`
              }));

              setSubscriptions(transformedSubscriptions);

              // Initialize form data with first subscription selected by default
              if (transformedSubscriptions.length > 0) {
                const firstSub = transformedSubscriptions[0];
                setFormData({
                  selectedSubscriptions: [firstSub.id],
                  subscriptionAddresses: {
                    [firstSub.id]: {
                      street: webhookPayload.subscriptions[0].current_address.address1,
                      city: webhookPayload.subscriptions[0].current_address.city,
                      state: webhookPayload.subscriptions[0].current_address.province,
                      zipCode: webhookPayload.subscriptions[0].current_address.zip,
                      country: 'United States'
                    }
                  }
                });
              }

              // Mark data as loaded to prevent future overrides
              setDataLoaded(true);
            }
          }
        }
      } catch (error) {
        console.log('Webhook server not available, using default data');
        // Fallback to default data if webhook server is not available
        setCustomerName('Manali Sharma');

        // Set default metadata for testing
        setCustomerMetadata({
          shopify_id: 7818727325739,
          recharge_id: 211519611,
          email: 'manali.sharma@e2msolutions.com',
          date_time: '2025-09-19T10:40:18-05:00'
        });

        setSubscriptions([
          {
            id: '1',
            name: 'ayush',
            address: '123 Maple Street, Apt 4B\nSpringfield, IL 62704'
          },
          {
            id: '2',
            name: 'rahul',
            address: '456 Oak Avenue, Suite 12\nChicago, IL 60616'
          }
        ]);

        // Initialize form data with first subscription
        setFormData({
          selectedSubscriptions: ['1'],
          subscriptionAddresses: {
            '1': {
              street: '123 Maple Street, Apt 4B',
              city: 'Springfield',
              state: 'IL',
              zipCode: '62704',
              country: 'United States'
            }
          }
        });

        // Mark data as loaded
        setDataLoaded(true);
      }
    };

    // Load data once on component mount
    loadWebhookData();

    // No cleanup needed since we're not using interval anymore
  }, []);



  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name.startsWith('address.')) {
      const parts = name.split('.');
      const subscriptionId = parts[1];
      const addressField = parts[2];

      // Update the form data immediately
      setFormData(prev => ({
        ...prev,
        subscriptionAddresses: {
          ...prev.subscriptionAddresses,
          [subscriptionId]: {
            ...prev.subscriptionAddresses[subscriptionId],
            [addressField]: addressField === 'state' ? normalizeStateToAbbreviation(value) : value
          }
        }
      }));

      // If it's a zipcode field, trigger the debounced state lookup
      if (addressField === 'zipCode') {
        handleZipcodeChange(subscriptionId, value);
      }

      // If it's a street field, trigger address suggestions
      if (addressField === 'street') {
        const currentAddress = formData.subscriptionAddresses[subscriptionId];
        if (currentAddress?.city && currentAddress?.state) {
          handleAddressInputChange(subscriptionId, value, currentAddress.city, currentAddress.state);
        }
      }
    } else if (name === 'selectedSubscriptions') {
      const target = e.target as HTMLInputElement;
      const subscriptionId = value;

      setFormData(prev => {
        let updatedSelections: string[];
        let updatedAddresses = { ...prev.subscriptionAddresses };

        if (target.checked) {
          // Add to selection if not already present
          updatedSelections = prev.selectedSubscriptions.includes(subscriptionId)
            ? prev.selectedSubscriptions
            : [...prev.selectedSubscriptions, subscriptionId];

          // If this subscription doesn't have an address yet, populate it
          if (!updatedAddresses[subscriptionId]) {
            const selectedSub = subscriptions.find(sub => sub.id === subscriptionId);
            if (selectedSub) {
              const addressParts = selectedSub.address.split('\n');
              const street = addressParts[0] || '';
              const cityStateZip = addressParts[1] || '';
              const cityStateZipParts = cityStateZip.split(', ');
              const city = cityStateZipParts[0] || '';
              const stateZip = cityStateZipParts[1] || '';
              const stateZipParts = stateZip.split(' ');
              const state = stateZipParts[0] || '';
              const zipCode = stateZipParts[1] || '';

              updatedAddresses[subscriptionId] = {
                street: street,
                city: city,
                state: state,
                zipCode: zipCode,
                country: 'United States'
              };
            }
          }
        } else {
          // Remove from selection
          updatedSelections = prev.selectedSubscriptions.filter(id => id !== subscriptionId);
          // Remove the address data for this subscription
          delete updatedAddresses[subscriptionId];
        }

        return {
          ...prev,
          selectedSubscriptions: updatedSelections,
          subscriptionAddresses: updatedAddresses
        };
      });
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    console.log('Form submitted!');
    console.log('Form data:', formData);
    console.log('Selected subscriptions:', formData.selectedSubscriptions);
    console.log('Subscription addresses:', formData.subscriptionAddresses);

    // Check if all selected subscriptions have complete address information
    const allAddressesComplete = formData.selectedSubscriptions.every(subscriptionId => {
      const address = formData.subscriptionAddresses[subscriptionId];
      console.log(`Checking subscription ${subscriptionId}:`, address);
      return address && address.street && address.city && address.state && address.zipCode;
    });

    console.log('All addresses complete:', allAddressesComplete);
    console.log('Has selected subscriptions:', formData.selectedSubscriptions.length > 0);

    if (formData.selectedSubscriptions.length > 0 && allAddressesComplete) {
      console.log('Validation passed, sending to n8n...');
      try {
        // Prepare data for webhook in the required format
        const webhookData = formData.selectedSubscriptions.map(subscriptionId => {
          const subscription = subscriptions.find(sub => sub.id === subscriptionId);
          const newAddress = formData.subscriptionAddresses[subscriptionId];

          // Parse old address from subscription.address
          const oldAddressParts = subscription?.address.split('\n') || [];
          const oldStreet = oldAddressParts[0] || '';
          const oldCityStateZip = oldAddressParts[1] || '';
          const oldCityStateZipParts = oldCityStateZip.split(', ');
          const oldCity = oldCityStateZipParts[0] || '';
          const oldStateZip = oldCityStateZipParts[1] || '';
          const oldStateZipParts = oldStateZip.split(' ');
          const oldState = oldStateZipParts[0] || '';
          const oldZip = oldStateZipParts[1] || '';

          return {
            subscription_id: subscriptionId,
            subscription_name: subscription?.name || '',
            old_address: {
              address1: oldStreet,
              city: oldCity,
              province: oldState,
              zip: oldZip,
              country_code: "US"
            },
            new_address: {
              address1: newAddress.street,
              city: newAddress.city,
              province: newAddress.state,
              zip: newAddress.zipCode,
              country_code: "US"
            }
          };
        });

        // Send updated data back to n8n using GET method with query parameters
        // Include metadata that came from n8n
        const queryParams = new URLSearchParams({
          customer_name: customerName,
          shopify_id: customerMetadata.shopify_id?.toString() || '',
          recharge_id: customerMetadata.recharge_id?.toString() || '',
          email: customerMetadata.email,
          date_time: customerMetadata.date_time,
          updated_subscriptions: JSON.stringify(webhookData)
        });

        const response = await fetch(`https://historybymail.app.n8n.cloud/webhook/d93e3a8c-9f3b-410e-a375-6d301cf7d4a4?${queryParams}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        });

        if (response.ok) {
          console.log('Webhook called successfully');
          console.log('Address update submitted:', formData);
          setToastMessage('Your address will be updated successfully!');
          setShowToast(true);

          // Hide toast after 3 seconds
          setTimeout(() => {
            setShowToast(false);
          }, 3000);
        } else {
          console.error('Webhook call failed:', response.status);
          setToastMessage('Address update submitted, but there was an issue with the server.');
          setShowToast(true);

          // Hide toast after 3 seconds
          setTimeout(() => {
            setShowToast(false);
          }, 3000);
        }
      } catch (error) {
        console.error('Error calling webhook:', error);
        setToastMessage('Address update submitted, but there was an issue with the server.');
        setShowToast(true);

        // Hide toast after 3 seconds
        setTimeout(() => {
          setShowToast(false);
        }, 3000);
      }
    } else {
      console.log('Validation failed!');
      console.log('Selected subscriptions count:', formData.selectedSubscriptions.length);
      console.log('All addresses complete:', allAddressesComplete);

      // Show validation error toast
      setToastMessage('Please select at least one subscription and fill all required address fields.');
      setShowToast(true);

      setTimeout(() => {
        setShowToast(false);
      }, 3000);
    }
  };


  return (
    <div className="app-container">
      {showToast && (
        <div className="toast" style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          backgroundColor: '#4CAF50',
          color: 'white',
          padding: '16px 24px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 9999,
          fontSize: '16px',
          fontWeight: '500',
          maxWidth: '400px',
          animation: 'slideIn 0.3s ease-out'
        }}>
          {toastMessage}
        </div>
      )}
      <div className="email-container">
        <div className="header">
          <img src="https://historybymail.com/cdn/shop/files/HBM_Logo_without_BG.webp?v=1743576534&width=120" alt="History By Mail Logo" className="header-logo" />
          <h1>History By Mail</h1>
        </div>

        <div className="content">
          <div className="greeting">Dear {customerName || 'Valued Customer'},</div>

          <div className="message">
            We found multiple subscriptions on your account, Please select the subscription you want to update the address and provide your new address which you want to update.
          </div>

          <form onSubmit={handleSubmit} className="response-form">
            <div className="subscriptions-container">
              <table className="subscriptions-table">
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Subscription</th>
                    <th>Recipient Name</th>
                    <th>Current Address</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((subscription) => (
                    <tr key={subscription.id}>
                      <td className="subscription-select">
                        <input
                          type="checkbox"
                          name="selectedSubscriptions"
                          value={subscription.id}
                          checked={formData.selectedSubscriptions.includes(subscription.id)}
                          onChange={handleInputChange}
                        />
                      </td>
                      <td className="subscription-number">Subscription - {subscription.id}</td>
                      <td className="subscription-name">{subscription.name}</td>
                      <td className="subscription-address">
                        {subscription.address.split('\n').map((line, index) => (
                          <span key={index}>
                            {line}
                            {index < subscription.address.split('\n').length - 1 && <br />}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>


            {formData.selectedSubscriptions.map((subscriptionId) => {
              const subscription = subscriptions.find(sub => sub.id === subscriptionId);
              const address = formData.subscriptionAddresses[subscriptionId];

              return (
                <div key={subscriptionId} className="address-form-section">
                  <h3 className="section-title">
                    New Address Information for {subscription?.name} (Subscription - {subscriptionId})
                  </h3>

                  <div className="form-row">
                    <div className="form-group full-width">
                      <label htmlFor={`address.${subscriptionId}.street`} className="form-label">
                        Street Address *
                      </label>
                      <div className="address-input-container" style={{ position: 'relative' }}>
                        <input
                          type="text"
                          id={`address.${subscriptionId}.street`}
                          name={`address.${subscriptionId}.street`}
                          value={address?.street || ''}
                          onChange={handleInputChange}
                          onBlur={() => handleInputBlur(subscriptionId)}
                          placeholder="123 Main Street, Apt 4B"
                          className="form-input"
                          required
                          autoComplete="off"
                        />
                        {showSuggestions[subscriptionId] && addressSuggestions[subscriptionId]?.length > 0 && (
                          <div
                            className="address-suggestions"
                            style={{
                              position: 'absolute',
                              top: '100%',
                              left: 0,
                              right: 0,
                              backgroundColor: '#ffffff',
                              border: '2px solid #007bff',
                              borderTop: 'none',
                              borderRadius: '0 0 8px 8px',
                              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                              zIndex: 9999,
                              maxHeight: '250px',
                              overflowY: 'auto',
                              fontSize: '14px',
                              fontFamily: 'inherit'
                            }}
                          >
                            {addressSuggestions[subscriptionId].map((suggestion, index) => (
                              <div
                                key={index}
                                className="suggestion-item"
                                style={{
                                  padding: '12px 16px',
                                  cursor: 'pointer',
                                  borderBottom: index < addressSuggestions[subscriptionId].length - 1 ? '1px solid #e9ecef' : 'none',
                                  color: '#333333',
                                  fontSize: '14px',
                                  lineHeight: '1.4',
                                  backgroundColor: '#ffffff',
                                  transition: 'background-color 0.2s ease'
                                }}
                                onClick={() => handleSuggestionSelect(subscriptionId, suggestion)}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = '#e3f2fd';
                                  e.currentTarget.style.color = '#1976d2';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = '#ffffff';
                                  e.currentTarget.style.color = '#333333';
                                }}
                              >
                                {suggestion}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label htmlFor={`address.${subscriptionId}.city`} className="form-label">
                        City *
                      </label>
                      <input
                        type="text"
                        id={`address.${subscriptionId}.city`}
                        name={`address.${subscriptionId}.city`}
                        value={address?.city || ''}
                        onChange={handleInputChange}
                        placeholder="Springfield"
                        className="form-input"
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor={`address.${subscriptionId}.state`} className="form-label">
                        State *
                      </label>
                      <input
                        type="text"
                        id={`address.${subscriptionId}.state`}
                        name={`address.${subscriptionId}.state`}
                        value={address?.state || ''}
                        onChange={handleInputChange}
                        placeholder="IL"
                        className="form-input"
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor={`address.${subscriptionId}.zipCode`} className="form-label">
                        ZIP Code *
                      </label>
                      <input
                        type="text"
                        id={`address.${subscriptionId}.zipCode`}
                        name={`address.${subscriptionId}.zipCode`}
                        value={address?.zipCode || ''}
                        onChange={handleInputChange}
                        placeholder="62704"
                        className="form-input"
                        required
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label htmlFor={`address.${subscriptionId}.country`} className="form-label">
                        Country
                      </label>
                      <input
                        type="text"
                        id={`address.${subscriptionId}.country`}
                        name={`address.${subscriptionId}.country`}
                        value={address?.country || ''}
                        onChange={handleInputChange}
                        className="form-input"
                      />
                    </div>
                  </div>
                </div>
              );
            })}


            <div className="button-container">
              <button
                type="submit"
                className="response-button"
                onClick={() => console.log('Button clicked!')}
              >
                UPDATE ADDRESS
              </button>
            </div>
          </form>

          <div className="closing">
            Thank you for keeping your subscription information up to date. We'll ensure your next mails are delivered to your new address, however mails ordered prior to address change will be delivered on your old address
          </div>

          <div className="signature">
            Best regards,<br />
            History by Mail Support Team<br /><br />
            For any further inquiry you can contact us on support@historybymail.com
          </div>
        </div>

        <div className="footer">
          <p>History by Mail Support Team</p>
        </div>
      </div>
    </div>
  )
}

export default App
