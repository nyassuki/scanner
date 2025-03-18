/**
 * File Name: cex_arbitrage_bot.js
 * Author: Yasuki
 * Created Date: 2025-03-14
 * Description: A Node.js script to detect and execute arbitrage opportunities between BTSE and CoinEx.
 */

require('dotenv').config(); // Load .env file
const fs = require('fs');
const axios = require('axios');
const readline = require('readline');

const btse = require("./exchange/btse.js");
const coinex = require("./exchange/coinex.js");
const wallet_config = require("./libs/wallet_config.js");

const wallet_address = wallet_config.wallet_production;
const TELEGRAM_BOT_TOKEN = "7653132049:AAEtDIXivk1tomZULgLuLj8hD3VQc8I-XvM";
const TELEGRAM_CHAT_ID = "7615664261";

/**
 * Sends a message to a Telegram bot.
 * @param {string} message - The message to send.
 */
async function sendTelegramMessage(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
        });
    } catch (error) {
        console.error("❌ Error sending Telegram message:", error.response?.data || error.message);
    }
}

/**
 * Fetches the latest buy/sell prices and trading fees from exchanges.
 * @param {string} fromToken - The token being traded (e.g., "XMR").
 * @param {string} toToken - The target token (e.g., "USDT").
 * @returns {Promise<[Object[], Object[]]>} - Returns sorted price data and trading fees.
 */
async function getPrice(fromToken, toToken) {
    try {

        const fromTokenCoinex = convertTokenName(fromToken.toUpperCase());

        const [btse_rate, coinex_rate] = await Promise.all([
            btse.getPrice(fromToken, toToken).catch(() => null),
            coinex.getPrice(fromTokenCoinex, toToken).catch(() => null),
        ]);
        const [btse_trading_fee, coinex_trading_fee] = await Promise.all([
            btse.getTradingFeeRate(fromToken, toToken).catch(() => null),
            coinex.getTradingFeeRate(fromTokenCoinex, toToken).catch(() => null),
        ]);

        const rates = [{
                exchange: 'btse',
                rate: btse_rate?.price
            },
            {
                exchange: 'coinex',
                rate: coinex_rate?.price
            },
        ].filter(rate => rate.rate);

        const tradingFees = [{
                exchange: 'btse',
                tradingFee: btse_trading_fee?.makerFee || 0
            },
            {
                exchange: 'coinex',
                tradingFee: coinex_trading_fee?.makerFee || 0
            },
        ];

        rates.sort((a, b) => b.rate - a.rate);
        return [rates, tradingFees];
    } catch (error) {
        console.error('❌ Error fetching exchange rates:', error);
        throw error;
    }
}

/**
 * Prompts the user for confirmation before executing a trade.
 */
function getUserConfirmation() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question("⚠️  System running on manual mode, confirm if you want to proceed with this trade? (yes/no): ", (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === "y");
        });
    });
}


/**
 * Checks for arbitrage opportunities and calculates potential profit.
 * @param {string} TokenA - The token being traded (e.g., "XMR").
 * @param {string} TokenB - The target token (e.g., "USDT").
 * @param {number} TradingAmount - The amount to trade in TokenB.
 */
async function ArbitrageOpportunity(TokenA, TokenB, TradingAmount) {

    const fromTokenCoinex = convertTokenName(TokenA.toUpperCase());

    console.log(`\n🚀 Start finding ${TokenA}-${TokenB} arbitrage in ${process.env.OPORTUNITY_FIND} mode, amount ${TradingAmount} ${TokenB} `);
    try {
        let [rates, TradingFees] = await getPrice(TokenA, TokenB);
        if (rates.length < 2) return console.log("   ⚠️  Not enough data for arbitrage");

        let SellOn = rates[0];
        let BuyOn = rates[1];
        let BuyPrice = BuyOn.rate;
        let SellPrice = SellOn.rate;

        let BuyTradingFee = TradingFees.find(e => e.exchange === BuyOn.exchange)?.tradingFee || 0;
        let SellTradingFee = TradingFees.find(e => e.exchange === SellOn.exchange)?.tradingFee || 0;

        let tradingAmountAfterFee = TradingAmount - BuyTradingFee;
        let amountIN = tradingAmountAfterFee / BuyPrice;
        let BuySideWithdrawFee = 0.005;
        let SellSideWithdrawFee = 2.5;
        let amountAfterWithdrawFee = amountIN - BuySideWithdrawFee;
        let AmountOut = (amountAfterWithdrawFee * SellPrice) - SellTradingFee;
        let margin = AmountOut - TradingAmount - SellSideWithdrawFee;
        let margin_proc = (margin/TradingAmount)*100;
        console.log(`\nPrice table :`);
        console.table([{
            Trading_Pair: `${TokenA}/${TokenB}`,
            Buy_Exchange: BuyOn.exchange,
            Sell_Exchange: SellOn.exchange,
            Buy_Price: BuyPrice.toFixed(4),
            Buy_Fee: BuyTradingFee,
            Sell_Price: SellPrice.toFixed(4),
            Sell_Fee: SellTradingFee,
        }]);
        console.log(`\nTrade table :`);
        console.table([{
            Amount_B_IN: `${TradingAmount} ${TokenB}`,
            Amount_A_IN: `${amountIN.toFixed(4)} ${TokenA}`,
            BuySide_Withdraw_Fee: `${BuySideWithdrawFee} ${TokenA}`,
            Amount_B_OUT: `${AmountOut.toFixed(4)} ${TokenB}`,
            SellSide_Withdraw_Fee: `${SellSideWithdrawFee} ${TokenB}`,
            P_L: `${margin.toFixed(4)} ${TokenB}`,
        }]);

        let resultMessage = `\n✅ Arbitrage Opportunity Found on ${TokenA} ${TokenB} ! \n\n` +
            `💰 Trading Amount: ${TradingAmount} ${TokenB}\n` +
            `   🟢 Buy ${TokenA} on ${BuyOn.exchange} at ${BuyPrice.toFixed(4)}\n` +
            `   🔴 Sell ${TokenA} on ${SellOn.exchange} at ${SellPrice.toFixed(4)}\n` +
            `   💵 Estimated Profit: ${margin.toFixed(4)} ${TokenB} (${margin_proc.toFixed(2)} %)\n`;

        if (margin > 0) {
            console.log(resultMessage);
            await sendTelegramMessage(resultMessage);

            //get tokenB balance before execute trading :
            let getBalance = 0;
            if (BuyOn.exchange == "btse") {
                getBalance = await btse.getBalanceByAsset(TokenB);
            } else {
                getBalance = await coinex.getBalanceByAsset(TokenB);
            }
            let freeBalance = getBalance.free;
            let isEnoughBalance = TradingAmount - freeBalance;
            

            //get trading confirmation if manual mode
            if (process.env.OPORTUNITY_FIND === "manual") {
                const userConfirmed = await getUserConfirmation();
                if (!userConfirmed) return console.log("❌ Trade Canceled.");
            }
            //SPOT trading in exchangeA (Buy Exchange) (TokenA/TokenB action buy)
            let BuySize = 0;
            if(process.env.TRADING_AMONT_BY=="balance") {
                BuySize = freeBalance/ BuyPrice;
            } else if(process.env.TRADING_AMONT_BY=="input") {
                BuySize = TradingAmount/ BuyPrice;
                console.log(`👛 ${TokenB} balance on ${BuyOn.exchange} : ${freeBalance}, amount needed ${TradingAmount} ${TokenB} `);
            }

            console.log(`🛒 Starting buy action,  buy size : ${BuySize.toFixed(4)} ${TokenA}`);
            let BuyAction = "";
            if (BuyOn.exchange == "btse") {
                BuyAction = await btse.spotTradeTokens(TokenA, TokenB, "BUY", BuySize.toFixed(2));
            } else if (BuyOn.exchange == "coinex") {
                BuyAction = await coinex.spotTradeTokens(fromTokenCoinex, TokenB, "BUY", BuySize.toFixed(2));
            }

            if (BuyAction.code != -1) {
                //Withdraw token A to exchangeB
                //get withdraw address
                let DestAddress = "";
                let withdrawAction = "";
                if (BuyOn.exchange == "btse") {
                    console.log(`💰 Trade ${tokenA} success, continue to withdraw to ${SellOn.exchange}`);
                    let WgetBalance = await btse.getBalanceByAsset(TokenA);
                    await WitdrawToCoinex(TokenA,WgetBalance.free);
                    await TradeOnCoinex(fromTokenCoinex, TokenB, "sell");

                } else if (BuyOn.exchange == "coinex"){
                    console.log(`💰 Trade ${fromTokenCoinex} success, continue to withdraw to ${SellOn.exchange}`);
                    let WgetBalance = await coinex.getBalanceByAsset(fromTokenCoinex);
                    await WithdrawToBTSE(TokenA, WgetBalance.free);
                    await TradeOnBTSE(TokenA, TokenB, "sell");
                }
            } else {
                console.log(`   🔴 Action buy error code (${BuyAction.code}) : ${BuyAction.msg}`);
            }
            //SPOT TRading in exchangeB (sell Exchange) (TokenA/TokenB action sell)
            //Withdraw TokenB to ExchangeA (Buy Exchnage)
        } else if (margin <= -5) {
            console.log(resultMessage);
            await sendTelegramMessage(resultMessage);
        } else {
            console.log(`❌ No profitable arbitrage found on ${TokenA} ${TokenB},  Loss: ${margin.toFixed(4)} ${TokenB}\n`);
        }
    } catch (error) {
        console.error("❌ Error in arbitrage calculation:\n", error);
    }
}
async function ScanArbitrage() {
    const availableCurrency = await coinex.AvailableCurrency("CONVERT");
    let TotalToken = availableCurrency.length;
    console.log(`✅ Total token : ${TotalToken}`);
    for (const fromToken of availableCurrency) {
        TotalToken--;
        const toToken = "USDT";
        console.log(`✅ Checking oportunity ${fromToken.toUpperCase()}-${toToken.toUpperCase()} token left ${TotalToken}`);
        await ArbitrageOpportunity(fromToken.toUpperCase(), toToken.toUpperCase(), 10);
        await delay(2000); // Pastikan delay() didefinisikan
    }
}
// Fungsi delay untuk menunggu sebelum iterasi berikutnya
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function convertTokenName(TokenA) {
    if (TokenA == "TRUMP") {
        fromTokenCoinex = "MAGATRUMP";
    } else if (TokenA == "TRUMPSOL") {
        fromTokenCoinex = "TRUMP";
    } else if (TokenA == "TRAC") {
        fromTokenCoinex = "TRACBRC";
    } else {
        fromTokenCoinex = TokenA;
    }
    return fromTokenCoinex;
}

async function TradeOnBTSE(TokenA, TokenB, side) {
    try {
        let TradeableBalance = 0; // Initialize balance
        // Keep checking until balance is greater than 0
        let UbalanceConter=0;
        do {
            UbalanceConter++;
            if(UbalanceConter/4==1) {console.clear();UbalanceConter=1}
            let getTradeableBalance = await btse.getBalanceByAsset(TokenA);
            TradeableBalance = getTradeableBalance.free - (0.02 / 100 * getTradeableBalance.free);
            // Optional: Wait for a few seconds before checking again (to avoid spamming API calls)
            if (TradeableBalance <= 0) {
                console.log(`⏳ Tradeable ${TokenA} balance: ${TradeableBalance}, ( ${UbalanceConter} ) Waiting for balance to update...`);
                await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 5 seconds
            }
        } while (TradeableBalance <= 0);
        console.log("✅ Tradeable balance is now available. Proceeding with trading...");
        
        let swapOnSellExchange = await btse.swapTokens(TokenA, TokenB, side,TradeableBalance);
        if(swapOnSellExchange.code != -1) {
            let widrawAbleBalance = 0; // Initialize balance
            // Keep checking until balance is greater than 0
            do {
                let getWidrawableBalance = await btse.getBalanceByAsset(TokenB);
                widrawAbleBalance = getWidrawableBalance.free - 2.5;
                console.log(`💰 Withdrawable ${TokenB} balance: ${widrawAbleBalance.toFixed(4)}`);

                // If balance is still too low, wait before checking again
                if (widrawAbleBalance <= 0) {
                    console.log("⏳ Waiting for balance to update...");
                    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
                }

            } while (widrawAbleBalance <= 0);
            console.log(`✅ Trading success, withdrawing ${widrawAbleBalance} ${TokenB} to buy exchange...`);
            await WitdrawToCoinex(widrawAbleBalance);
        } else {
            console.log(`⚠️ `,`(${swapOnSellExchange.code}) ${swapOnSellExchange.msg}`);
        }
    } catch(err) {
        console.log(`⚠️ ${err}`);
    }
}

async function TradeOnCoinex(TokenA, TokenB, side) {
    try {
        let fromTokenCoinex = convertTokenName(TokenA) 
        let TradeableBalance = 0; // Initialize balance
        // Keep checking until balance is greater than 0
        let UbalanceConter=0;
        do {
            UbalanceConter++;
            if(UbalanceConter/4==1) {console.clear();UbalanceConter=1}
            let getTradeableBalance = await coinex.getBalanceByAsset(fromTokenCoinex);
            TradeableBalance = getTradeableBalance.free - (0.02 / 100 * getTradeableBalance.free);
            // Optional: Wait for a few seconds before checking again (to avoid spamming API calls)
            if (TradeableBalance <= 0) {
                console.log(`⏳ Tradeable ${fromTokenCoinex} balance: ${TradeableBalance}, ( ${UbalanceConter} ) Waiting for balance to update...`);
                await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 5 seconds
            }
        } while (TradeableBalance <= 0);
        console.log("✅ Tradeable balance is now available. Proceeding with trading...");
        
        let swapOnSellExchange = await coinex.swapTokens(fromTokenCoinex, TokenB, side,TradeableBalance);
        if(swapOnSellExchange.code != -1) {
            let widrawAbleBalance = 0; // Initialize balance
            // Keep checking until balance is greater than 0
            do {
                let getWidrawableBalance = await coinex.getBalanceByAsset(TokenB);
                widrawAbleBalance = getWidrawableBalance.free - 2.5;
                console.log(`💰 Withdrawable ${TokenB} balance: ${widrawAbleBalance.toFixed(4)}`);

                // If balance is still too low, wait before checking again
                if (widrawAbleBalance <= 0) {
                    console.log("⏳ Waiting for balance to update...");
                    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
                }

            } while (widrawAbleBalance <= 0);
            console.log(`✅ Trading success, withdrawing ${widrawAbleBalance} ${TokenB} to buy exchange...`);
            await WithdrawToBTSE(widrawAbleBalance);
        } else {
            console.log(`⚠️ `,`(${swapOnSellExchange.code}) ${swapOnSellExchange.msg}`);
        }
    } catch(err) {
        console.log(`⚠️ ${err}`);
    }
}


async function WithdrawToBTSE(token, amount) {
    let CoinConvert = await convertTokenName(token);
    let wallet_address =await getbtseWalletAddress(token);
    let withdrawAction = await coinex.withdrawToken(CoinConvert, amount, wallet_address, "ERC20");
    console.log(withdrawAction);
}
async function WitdrawToCoinex(token,amount) {
    let CoinConvert = await convertTokenName(token);
    let wallet_address =await getcoinexWalletAddress(CoinConvert);
    let withdrawAction = await btse.withdrawToken(token, amount, wallet_address, "ERC20");
    console.log(withdrawAction);
}
async function getcoinexWalletAddress(token) {
    let CoinConvert = await convertTokenName(token);
    let DestAddress = await coinex.getWalletAddress(CoinConvert, "ERC20");
    return DestAddress.address;
}
async function getbtseWalletAddress(token) {
    let DestAddress = await btse.getWalletAddress(token, "ERC20");
    return DestAddress.address;
}
async function FoundArbitrage() {
    console.clear();
    try {
        const args = process.argv.slice(2);
        const fromToken = args[0] || "XMR";
        const toToken = args[1] || "USDT";
        const amount = args[2] || 10;
        while (true) {
            await ArbitrageOpportunity(fromToken.toUpperCase(), toToken.toUpperCase(), amount);
            await delay(10000);
        }
    } catch (err) {
        console.error("⚠️ Error in main function:", err);
    }
}

//TradeOnCoinex("TRUMP", "USDT", "SELL");
TradeOnBTSE("TRUMP", "USDT", "SELL");
//getbtseWalletAddress("MAGATRUMP");
//FoundArbitrage();
//withdrawBTSE();