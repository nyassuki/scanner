const axios = require('axios'); // HTTP client for making API requests
const crypto = require('crypto'); // Crypto module for generating HMAC signatures
require('dotenv').config(); // Load environment variables from .env file

// Replace with your CoinEx API credentials
const ACCESS_ID = process.env.COIN_EX_ACCESS_ID; // CoinEx API access ID
const SECRET_KEY = process.env.COINEX_SECRET_KEY; // CoinEx API secret key

// CoinEx API base URL
const API_BASE_URL = process.env.COINEX_API_BASE_URL;

/**
 * Generates the HMAC-SHA256 signature for CoinEx API requests.
 *
 * @param {string} method - HTTP method (e.g., 'GET', 'POST').
 * @param {string} requestPath - API endpoint path (e.g., '/v1/market/ticker').
 * @param {string} timestamp - Current timestamp in milliseconds.
 * @param {string} body - Request body (for POST requests) or empty string (for GET requests).
 * @returns {string} - The HMAC-SHA256 signature in lowercase hexadecimal format.
 */
function generateSignature(method, requestPath, timestamp, body = '') {
    const preparedStr = `${method}${requestPath}${body}${timestamp}`; // Prepare the string for signing
    return crypto
        .createHmac('sha256', Buffer.from(SECRET_KEY, 'latin1')) // Create HMAC-SHA256 instance
        .update(Buffer.from(preparedStr, 'latin1')) // Update HMAC with the prepared string
        .digest('hex') // Generate the signature
        .toLowerCase(); // Convert to lowercase
}

/**
 * Fetches the current system time from CoinEx.
 *
 * @returns {Promise<number>} - The current timestamp in milliseconds.
 */
async function getSystemTime() {
    const endpoint = '/v2/time'; // API endpoint for system time
    const response = await axios.get(`${API_BASE_URL}${endpoint}`); // Make the API request
    return response.data.data.timestamp; // Return the timestamp
}

/**
 * Fetches the exchange rate for a trading pair.
 *
 * @param {string} fromAsset - The base currency (e.g., 'BTC').
 * @param {string} toAsset - The quote currency (e.g., 'USDT').
 * @returns {Promise<Object>} - The exchange rate response containing price and reverse price.
 */
async function getExchangeRate(fromAsset, toAsset) {
    try {
		let swapable = await checkTradingPair(fromAsset, toAsset);
		if(swapable==true) {
			const endpoint = '/v1/market/ticker'; // API endpoint for ticker data
			const params = {
				market: `${fromAsset}${toAsset}`, // Trading pair (e.g., BTCUSDT)
			};

			const response = await axios.get(`${API_BASE_URL}${endpoint}`, { params }); // Make the API request
			if (response.data.code === 0) {
				return {
					price: parseFloat(response.data.data.ticker.last), // Last traded price
					reserve_price: parseFloat(1 / response.data.data.ticker.last), // Reverse price
				};
			} else {
				return { price: 0, reserve_price: 0, msg: response.data.code }; // Return 0 if error
			}
		} else {
			return { price: 0, reserve_price: 0};
		}
    } catch (error) {
        return { price: 0, reserve_price: 0, code:error.response.code }; // Return 0 on error
    }
}

async function getTradingFeeRate(fromAsset, toAsset) {
    try {
        const endpoint = `/v2/account/trade-fee-rate?market_type=SPOT&market=${fromAsset}${toAsset}`; // API endpoint for balance
        const method = 'GET'; // HTTP method
        const timestamp = await getSystemTime(); // Current timestamp
        const signature = generateSignature(method, endpoint, timestamp); // Generate signature

        const headers = {
            'X-COINEX-TIMESTAMP': timestamp, // Include the timestamp in the headers
            'X-COINEX-SIGN': signature, // Include the signature in the headers
            'X-COINEX-KEY': ACCESS_ID, // Include the access ID in the headers
            'Content-Type': 'application/json', // Set the content type
        };

        const response = await axios.get(`${API_BASE_URL}${endpoint}`, { headers }); // Make the API request
 
        if (response.data.code === 0) {
            return {
                makerFee: response.data.data.maker_rate, // Available balance
                takerFee: response.data.data.taker_rate, // Locked balance
            };
        } else {
            return {
                makerFee: 0, // Available balance
                takerFee: 0, // Locked balance
            };
        }
    } catch (error) {
        return {
                makerFee: 0, // Available balance
                takerFee: 0, // Locked balance
            };
    }
}

/**
 * Fetches the price for a trading pair.
 *
 * @param {string} fromAsset - The base currency (e.g., 'BTC').
 * @param {string} toAsset - The quote currency (e.g., 'USDT').
 * @returns {Promise<Object>} - The exchange rate response containing price and reverse price.
 */

async function getPrice(fromAsset, toAsset) {
    return await getExchangeRate(fromAsset, toAsset);
}
/**
 * Swaps tokens on CoinEx (places a market or limit order).
 *
 * @param {string} fromAsset - The asset to swap from (e.g., 'BTC').
 * @param {string} toAsset - The asset to swap to (e.g., 'USDT').
 * @param {number} amount - The amount to swap.
 * @param {number|null} price - The price for limit orders (optional).
 * @returns {Promise<Object>} - The swap response.
 */
  
async function swapTokens(fromAsset, toAsset, side,amount, price = null) {
    try {
        const endpoint = '/v2/spot/order'; // API endpoint for placing orders
        const market = `${fromAsset}${toAsset}`; // Trading pair (e.g., BTCUSDT)
        const method = 'POST'; // HTTP method
        const timestamp = await getSystemTime(); // Current timestamp
        const body = JSON.stringify({
            market:`${fromAsset}${toAsset}`,
            market_type: 'SPOT', // Spot market
            type: price ? 'limit' : 'market', // Order type (market or limit)
            side: 'buy', // 'buy' or 'sell'
            amount: amount.toString(), // Order amount
            price: price ? price.toString() : undefined, // Price for limit orders
        });

        const signature = generateSignature(method, endpoint, timestamp, body); // Generate signature

        const headers = {
            'X-COINEX-TIMESTAMP': timestamp, // Include the timestamp in the headers
            'X-COINEX-SIGN': signature, // Include the signature in the headers
            'X-COINEX-KEY': ACCESS_ID, // Include the access ID in the headers
            'Content-Type': 'application/json', // Set the content type
        };

        const response = await axios.post(`${API_BASE_URL}${endpoint}`, body, { headers }); // Make the API request
		//console.log(response);
        if (response.data.code === 0) {
            return response.data; // Return the order response
        } else {
            return {code:-1,msg:response.data.message};
        }
    } catch (error) {
        //console.error('Error swapping tokens:', error.response ? error.response.data : error.message);
      
    }
}

async function AvailableCurrency() {
    try {
        const response = await axios.get("https://api.coinex.com/v1/market/list");
        const allPairs = response.data.data;
        const usdtPairs = allPairs.filter(pair => pair.endsWith("USDT"));
        const firstTokens = usdtPairs.map(pair => pair.replace("USDT", ""));
        return firstTokens;
    } catch (error) {
        console.error("Error fetching tradeable tokens:", error.response ? error.response.data : error.message);
    }
}


/**
 * Withdraws tokens from CoinEx.
 *
 * @param {string} asset - The asset to withdraw (e.g., 'BTC').
 * @param {number} amount - The amount to withdraw.
 * @param {string} address - The destination address.
 * @param {string} chain - The blockchain network (e.g., 'ERC20').
 * @returns {Promise<Object>} - The withdrawal response.
 */
async function withdrawToken(asset, amount, address, chain) {
    try {
        const endpoint = '/v2/assets/withdraw'; // API endpoint for withdrawals
        const method = 'POST'; // HTTP method
        const timestamp = await getSystemTime(); // Current timestamp
        const body = JSON.stringify({
            ccy: asset, // Currency to withdraw
            to_address: address, // Destination address
            chain, // Blockchain network
            amount: amount.toString(), // Amount to withdraw
        });

        const signature = generateSignature(method, endpoint, timestamp, body); // Generate signature

        const headers = {
            'X-COINEX-TIMESTAMP': timestamp, // Include the timestamp in the headers
            'X-COINEX-SIGN': signature, // Include the signature in the headers
            'X-COINEX-KEY': ACCESS_ID, // Include the access ID in the headers
            'Content-Type': 'application/json', // Set the content type
        };

        const response = await axios.post(`${API_BASE_URL}${endpoint}`, body, { headers }); // Make the API request

        if (response.data.code === 0) {
            return {
                withdrawal_amount: response.data.actual_amount, // Actual withdrawal amount
                tx_fee: response.data.frozen, // Transaction fee
            };
        } else {
            return response.data; // Return the error response
        }
    } catch (error) {
        //console.error('Error withdrawing token:', error.response ? error.response.data : error.message);
        //throw error; // Throw error for handling
    }
}

/**
 * Fetches the balance of a specific asset.
 *
 * @param {string} asset - The asset (e.g., 'BTC').
 * @returns {Promise<Object>} - The balance response containing free and locked amounts.
 */
async function getBalanceByAsset(asset) {
    try {
        const endpoint = `/v2/assets/spot/balance?ccy=${asset}`; // API endpoint for balance
        const method = 'GET'; // HTTP method
        const timestamp = await getSystemTime(); // Current timestamp
        const signature = generateSignature(method, endpoint, timestamp); // Generate signature

        const headers = {
            'X-COINEX-TIMESTAMP': timestamp, // Include the timestamp in the headers
            'X-COINEX-SIGN': signature, // Include the signature in the headers
            'X-COINEX-KEY': ACCESS_ID, // Include the access ID in the headers
            'Content-Type': 'application/json', // Set the content type
        };

        const response = await axios.get(`${API_BASE_URL}${endpoint}`, { headers }); // Make the API request
        const result = response.data.data;
        const filteredData = result.filter(item => item.ccy === asset);

         if (response.data.code === 0) {
            if(filteredData.length > 0 ) {
                return {
                    free: filteredData[0].available, // Available balance
                    locked: filteredData[0].frozen, // Locked balance
                };
            } else {
                return {
                    free: 0, // Available balance
                    locked: 0, // Locked balance
                };
            }
        } else {
            return response.data; // Return the error response
        }
    } catch (error) {
        //console.error('Error fetching balance:', error.response ? error.response.data : error.message);
        throw error; // Throw error for handling
    }
}
async function getWalletAddress(currency, network) {
	try {
        const endpoint = `/v2/assets/deposit-address?ccy=${currency}&chain=${network}`; // API endpoint for balance
        const method = 'GET'; // HTTP method
        const timestamp = await getSystemTime(); // Current timestamp
        const signature = generateSignature(method, endpoint, timestamp); // Generate signature

        const headers = {
            'X-COINEX-TIMESTAMP': timestamp, // Include the timestamp in the headers
            'X-COINEX-SIGN': signature, // Include the signature in the headers
            'X-COINEX-KEY': ACCESS_ID, // Include the access ID in the headers
            'Content-Type': 'application/json', // Set the content type
        };

        const response = await axios.get(`${API_BASE_URL}${endpoint}`, { headers }); // Make the API request

        if (response.data.code === 0) {
            return { address: response.data.data.address};
        } else {
           return { address: 0};
        }
    } catch (error) {
       return { address: 0};
    }
}	


async function checkTradingPair(tokenA, tokenB) {
	try {
		const endpoint = `/v2/spot/market?market=${tokenA}${tokenB}`;
        const method = 'GET'; // HTTP method
        const timestamp = await getSystemTime(); // Current timestamp
        const signature = generateSignature(method, endpoint, timestamp); // Generate signature

        const headers = {
            'X-COINEX-TIMESTAMP': timestamp, // Include the timestamp in the headers
            'X-COINEX-SIGN': signature, // Include the signature in the headers
            'X-COINEX-KEY': ACCESS_ID, // Include the access ID in the headers
            'Content-Type': 'application/json', // Set the content type
        };

        const response = await axios.get(`${API_BASE_URL}${endpoint}`, { headers }); // Make the API request

        if (response.data.code === 0) {
            return true;
        } else {
           return false;
        }
    } catch (error) {
           return false;
    }
}
//main();
async function main() {
	let address = await getTradingFeeRate("XMR", "USDT", "100");
	console.log(address);
}

module.exports = {
    getBalanceByAsset,
    getExchangeRate,
    getPrice,
    swapTokens,
    withdrawToken,
	getWalletAddress,
    getTradingFeeRate,
    AvailableCurrency
};