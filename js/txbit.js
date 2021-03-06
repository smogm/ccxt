'use strict';

// ---------------------------------------------------------------------------

const bittrex = require ('./bittrex.js');
const { ExchangeError } = require ('./base/errors');

// ---------------------------------------------------------------------------

module.exports = class txbit extends bittrex {
    describe () {
        const timeframes = {
            '5m': '5m',
            '15m': '15m',
            '30m': '30m',
            '1h': '1h',
            '6h': '6h',
            '1d': '1d',
            '1w': '1w',
            '2w': '2w',
        };
        const result = this.deepExtend (super.describe (), {
            'id': 'txbit',
            'name': 'Txbit.io',
            'countries': [ 'NL' ], // Netherlands
            'rateLimit': 1000,
            'certified': false,
            'version': '',
            'timeframes': timeframes,
            'has': {
                'CORS': true,
                'createMarketOrder': false,
                'fetchDepositAddress': true,
                'fetchClosedOrders': true,
                'fetchCurrencies': true,
                'fetchMyTrades': 'emulated',
                'fetchOHLCV': false,
                'fetchOrder': true,
                'fetchOpenOrders': true,
                'fetchTickers': true,
                'withdraw': true,
                'fetchDeposits': true,
                'fetchWithdrawals': true,
                'fetchTransactions': false,
            },
            'hostname': 'api.txbit.io',
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/2078175/66576388-ee1ca100-eb77-11e9-89e8-75808e4389eb.jpg',
                'api': {
                    'public': 'https://{hostname}/api',
                    'account': 'https://{hostname}/api',
                    'market': 'https://{hostname}/api',
                },
                'www': 'https://txbit.io',
                'doc': [
                    'https://apidocs.txbit.io',
                ],
                'fees': 'https://txbit.io/Fee',
            },
            'api': {
                'account': {
                    'get': [
                        'balance',
                        'balances',
                        'depositaddress',
                        'deposithistory',
                        'order',
                        'orderhistory',
                        'withdrawhistory',
                        'withdraw',
                    ],
                },
                'public': {
                    'get': [
                        'currencies',
                        'markethistory',
                        'markets',
                        'marketsummaries',
                        'marketsummary',
                        'orderbook',
                        'ticker',
                        'systemstatus',
                        'currencyinformation',
                        'currencybalancesheet',
                    ],
                },
                'market': {
                    'get': [
                        'buylimit',
                        'selllimit',
                        'cancel',
                        'openorders',
                    ],
                },
            },
            'fees': {
                'funding': {
                    'withdraw': {
                        'BTC': 0.001,
                    },
                },
            },
            'options': {
                // price precision by quote currency code
                'pricePrecisionByCode': {
                    'USD': 3,
                    'BTC': 8,
                },
                'parseOrderStatus': true,
                'disableNonce': false,
                'symbolSeparator': '/',
            },
            'verbose': true,
        });
        return result;
    }

    async fetchMarkets (params = {}) {
        // https://github.com/ccxt/ccxt/issues/5668
        const response = await this.publicGetMarkets (params);
        const result = [];
        const markets = this.safeValue (response, 'result');
        for (let i = 0; i < markets.length; i++) {
            const market = markets[i];
            const id = this.safeString (market, 'MarketName');
            const baseId = this.safeString (market, 'MarketCurrency');
            const quoteId = this.safeString (market, 'BaseCurrency');
            const base = this.safeCurrencyCode (baseId);
            const quote = this.safeCurrencyCode (quoteId);
            const symbol = base + '/' + quote;
            let pricePrecision = 8;
            if (quote in this.options['pricePrecisionByCode']) {
                pricePrecision = this.options['pricePrecisionByCode'][quote];
            }
            const precision = {
                'amount': 8,
                'price': pricePrecision,
            };
            // bittrex uses boolean values, bleutrade uses strings
            let active = this.safeValue (market, 'IsActive', false);
            if ((active !== 'false') && active) {
                active = true;
            } else {
                active = false;
            }
            result.push ({
                'id': id,
                'symbol': symbol,
                'base': base,
                'quote': quote,
                'baseId': baseId,
                'quoteId': quoteId,
                'active': active,
                'info': market,
                'precision': precision,
                'limits': {
                    'amount': {
                        'min': this.safeFloat (market, 'MinTradeSize'),
                        'max': undefined,
                    },
                    'price': {
                        'min': Math.pow (10, -precision['price']),
                        'max': undefined,
                    },
                },
            });
        }
        return result;
    }

    parseOrderStatus (status) {
        const statuses = {
            'OK': 'closed',
            'OPEN': 'open',
            'CANCELED': 'canceled',
        };
        return this.safeString (statuses, status, status);
    }

    async fetchOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        // Possible params
        // orderstatus (ALL, OK, OPEN, CANCELED)
        // ordertype (ALL, BUY, SELL)
        // depth (optional, default is 500, max is 20000)
        await this.loadMarkets ();
        let market = undefined;
        let marketId = 'ALL';
        if (symbol !== undefined) {
            market = this.market (symbol);
            marketId = market['id'];
        }
        const request = {
            'market': marketId,
            'orderstatus': 'ALL',
        };
        const response = await this.accountGetOrders (this.extend (request, params));
        return this.parseOrders (response['result'], market, since, limit);
    }

    async fetchClosedOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        const response = await this.fetchOrders (symbol, since, limit, params);
        return this.filterBy (response, 'status', 'closed');
    }

    getOrderIdField () {
        return 'orderid';
    }

    parseSymbol (id) {
        let [ base, quote ] = id.split (this.options['symbolSeparator']);
        base = this.safeCurrencyCode (base);
        quote = this.safeCurrencyCode (quote);
        return base + '/' + quote;
    }

    async fetchOrderBook (symbol, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const request = {
            'market': this.marketId (symbol),
            'type': 'both',
        };
        if (limit !== undefined) {
            request['depth'] = limit; // 50
        }
        const response = await this.publicGetOrderbook (this.extend (request, params));
        const orderbook = this.safeValue (response, 'result');
        if (!orderbook) {
            throw new ExchangeError (this.id + ' publicGetOrderbook() returneded no result ' + this.json (response));
        }
        return this.parseOrderBook (orderbook, undefined, 'buy', 'sell', 'Rate', 'Quantity');
    }

    async fetchOrderTrades (id, symbol = undefined, since = undefined, limit = undefined, params = {}) {
        // Currently we can't set the makerOrTaker field, but if the user knows the order side then it can be
        // determined (if the side of the trade is different to the side of the order, then the trade is maker).
        // Similarly, the correct 'side' for the trade is that of the order.
        // The trade fee can be set by the user, it is always 0.25% and is taken in the quote currency.
        await this.loadMarkets ();
        const request = {
            'orderid': id,
        };
        const response = await this.accountGetOrderhistory (this.extend (request, params));
        return this.parseTrades (response['result'], undefined, since, limit, {
            'order': id,
        });
    }

    async fetchTransactionsByType (type, code = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const method = (type === 'deposit') ? 'accountGetDeposithistory' : 'accountGetWithdrawhistory';
        const response = await this[method] (params);
        const result = this.parseTransactions (response['result']);
        return this.filterByCurrencySinceLimit (result, code, since, limit);
    }

    async fetchDeposits (code = undefined, since = undefined, limit = undefined, params = {}) {
        return await this.fetchTransactionsByType ('deposit', code, since, limit, params);
    }

    async fetchWithdrawals (code = undefined, since = undefined, limit = undefined, params = {}) {
        return await this.fetchTransactionsByType ('withdrawal', code, since, limit, params);
    }

    parseTrade (trade, market = undefined) {
        const timestamp = this.parse8601 (trade['TimeStamp'] + '+00:00');
        let side = undefined;
        if (trade['OrderType'] === 'BUY') {
            side = 'buy';
        } else if (trade['OrderType'] === 'SELL') {
            side = 'sell';
        }
        const id = this.safeString2 (trade, 'Id', 'ID');
        let symbol = undefined;
        if (market !== undefined) {
            symbol = market['symbol'];
        }
        let cost = undefined;
        const price = this.safeFloat (trade, 'Price');
        const amount = this.safeFloat (trade, 'Quantity');
        if (amount !== undefined) {
            if (price !== undefined) {
                cost = price * amount;
            }
        }
        return {
            'id': id,
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': symbol,
            'type': 'limit',
            'side': side,
            'order': undefined,
            'takerOrMaker': undefined,
            'price': price,
            'amount': amount,
            'cost': cost,
            'fee': undefined,
        };
    }

    async fetchTrades (symbol, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'market': market['id'],
        };
        const response = await this.publicGetMarkethistory (this.extend (request, params));
        if ('result' in response) {
            if (response['result'] !== undefined) {
                return this.parseTrades (response['result'], market, since, limit);
            }
        }
        throw new ExchangeError (this.id + ' fetchTrades() returned undefined response');
    }

    parseOrder (order, market = undefined) {
        //
        // fetchOrders
        //
        //     {
        //         OrderId: '107220258',
        //         Exchange: 'LTC_BTC',
        //         Type: 'SELL',
        //         Quantity: '2.13040000',
        //         QuantityRemaining: '0.00000000',
        //         Price: '0.01332672',
        //         Status: 'OK',
        //         Created: '2018-06-30 04:55:50',
        //         QuantityBaseTraded: '0.02839125',
        //         Comments: ''
        //     }
        //
        let side = this.safeString2 (order, 'OrderType', 'Type');
        const isBuyOrder = (side === 'LIMIT_BUY') || (side === 'BUY');
        const isSellOrder = (side === 'LIMIT_SELL') || (side === 'SELL');
        if (isBuyOrder) {
            side = 'buy';
        }
        if (isSellOrder) {
            side = 'sell';
        }
        // We parse different fields in a very specific order.
        // Order might well be closed and then canceled.
        let status = undefined;
        if (('Opened' in order) && order['Opened']) {
            status = 'open';
        }
        if (('Closed' in order) && order['Closed']) {
            status = 'closed';
        }
        if (('CancelInitiated' in order) && order['CancelInitiated']) {
            status = 'canceled';
        }
        if (('Status' in order) && this.options['parseOrderStatus']) {
            status = this.parseOrderStatus (this.safeString (order, 'Status'));
        }
        let symbol = undefined;
        const marketId = this.safeString (order, 'Exchange');
        if (marketId === undefined) {
            if (market !== undefined) {
                symbol = market['symbol'];
            }
        } else {
            if (marketId in this.markets_by_id) {
                market = this.markets_by_id[marketId];
                symbol = market['symbol'];
            } else {
                symbol = this.parseSymbol (marketId);
            }
        }
        let timestamp = undefined;
        if ('Opened' in order) {
            timestamp = this.parse8601 (order['Opened'] + '+00:00');
        }
        if ('Created' in order) {
            timestamp = this.parse8601 (order['Created'] + '+00:00');
        }
        let lastTradeTimestamp = undefined;
        if (('TimeStamp' in order) && (order['TimeStamp'] !== undefined)) {
            lastTradeTimestamp = this.parse8601 (order['TimeStamp'] + '+00:00');
        }
        if (('Closed' in order) && (order['Closed'] !== undefined)) {
            lastTradeTimestamp = this.parse8601 (order['Closed'] + '+00:00');
        }
        if (timestamp === undefined) {
            timestamp = lastTradeTimestamp;
        }
        let fee = undefined;
        let commission = undefined;
        if ('Commission' in order) {
            commission = 'Commission';
        } else if ('CommissionPaid' in order) {
            commission = 'CommissionPaid';
        }
        if (commission) {
            fee = {
                'cost': this.safeFloat (order, commission),
            };
            if (market !== undefined) {
                fee['currency'] = market['quote'];
            } else if (symbol !== undefined) {
                const currencyIds = symbol.split ('/');
                const quoteCurrencyId = currencyIds[1];
                fee['currency'] = this.safeCurrencyCode (quoteCurrencyId);
            }
        }
        let price = this.safeFloat (order, 'Price');
        let cost = undefined;
        const amount = this.safeFloat (order, 'Quantity');
        const remaining = this.safeFloat (order, 'QuantityRemaining');
        let filled = undefined;
        if (amount !== undefined && remaining !== undefined) {
            filled = amount - remaining;
        }
        if (!cost) {
            if (price && filled) {
                cost = price * filled;
            }
        }
        if (!price) {
            if (cost && filled) {
                price = cost / filled;
            }
        }
        const average = this.safeFloat (order, 'PricePerUnit');
        const id = this.safeString2 (order, 'OrderUuid', 'OrderId');
        return {
            'info': order,
            'id': id,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'lastTradeTimestamp': lastTradeTimestamp,
            'symbol': symbol,
            'type': 'limit',
            'side': side,
            'price': price,
            'cost': cost,
            'average': average,
            'amount': amount,
            'filled': filled,
            'remaining': remaining,
            'status': status,
            'fee': fee,
        };
    }

    parseTransaction (transaction, currency = undefined) {
        //
        //  deposit:
        //
        //     {
        //         Id: '96974373',
        //         Coin: 'DOGE',
        //         Amount: '12.05752192',
        //         TimeStamp: '2017-09-29 08:10:09',
        //         Label: 'DQqSjjhzCm3ozT4vAevMUHgv4vsi9LBkoE',
        //     }
        //
        // withdrawal:
        //
        //     {
        //         Id: '98009125',
        //         Coin: 'DOGE',
        //         Amount: '-483858.64312050',
        //         TimeStamp: '2017-11-22 22:29:05',
        //         Label: '483848.64312050;DJVJZ58tJC8UeUv9Tqcdtn6uhWobouxFLT;10.00000000',
        //         TransactionId: '8563105276cf798385fee7e5a563c620fea639ab132b089ea880d4d1f4309432',
        //     }
        //
        //     {
        //         "Id": "95820181",
        //         "Coin": "BTC",
        //         "Amount": "-0.71300000",
        //         "TimeStamp": "2017-07-19 17:14:24",
        //         "Label": "0.71200000;PER9VM2txt4BTdfyWgvv3GziECRdVEPN63;0.00100000",
        //         "TransactionId": "CANCELED"
        //     }
        //
        const id = this.safeString (transaction, 'Id');
        let amount = this.safeFloat (transaction, 'Amount');
        let type = 'deposit';
        if (amount < 0) {
            amount = Math.abs (amount);
            type = 'withdrawal';
        }
        const currencyId = this.safeString (transaction, 'Coin');
        const code = this.safeCurrencyCode (currencyId, currency);
        const label = this.safeString (transaction, 'Label');
        const timestamp = this.parse8601 (this.safeString (transaction, 'TimeStamp'));
        let txid = this.safeString (transaction, 'TransactionId');
        let address = undefined;
        let feeCost = undefined;
        const labelParts = label.split (';');
        if (labelParts.length === 3) {
            amount = parseFloat (labelParts[0]);
            address = labelParts[1];
            feeCost = parseFloat (labelParts[2]);
        } else {
            address = label;
        }
        let fee = undefined;
        if (feeCost !== undefined) {
            fee = {
                'currency': code,
                'cost': feeCost,
            };
        }
        let status = 'ok';
        if (txid === 'CANCELED') {
            txid = undefined;
            status = 'canceled';
        }
        return {
            'info': transaction,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'id': id,
            'currency': code,
            'amount': amount,
            'address': address,
            'tag': undefined,
            'status': status,
            'type': type,
            'updated': undefined,
            'txid': txid,
            'fee': fee,
        };
    }

    parseTicker (ticker, market = undefined) {
        //
        //     {
        //         "MarketName":"BTC-ETH",
        //         "High":0.02127099,
        //         "Low":0.02035064,
        //         "Volume":10288.40271571,
        //         "Last":0.02070510,
        //         "BaseVolume":214.64663206,
        //         "TimeStamp":"2019-09-18T21:03:59.897",
        //         "Bid":0.02070509,
        //         "Ask":0.02070510,
        //         "OpenBuyOrders":1228,
        //         "OpenSellOrders":5899,
        //         "PrevDay":0.02082823,
        //         "Created":"2015-08-14T09:02:24.817"
        //     }
        //
        const timestamp = this.parse8601 (this.safeString (ticker, 'TimeStamp'));
        let symbol = undefined;
        const marketId = this.safeString (ticker, 'MarketName');
        if (marketId !== undefined) {
            if (marketId in this.markets_by_id) {
                market = this.markets_by_id[marketId];
            } else {
                symbol = this.parseSymbol (marketId);
            }
        }
        if ((symbol === undefined) && (market !== undefined)) {
            symbol = market['symbol'];
        }
        const previous = this.safeFloat (ticker, 'PrevDay');
        const last = this.safeFloat (ticker, 'Last');
        let change = undefined;
        let percentage = undefined;
        if (last !== undefined) {
            if (previous !== undefined) {
                change = last - previous;
                if (previous > 0) {
                    percentage = (change / previous) * 100;
                }
            }
        }
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': this.safeFloat (ticker, 'High'),
            'low': this.safeFloat (ticker, 'Low'),
            'bid': this.safeFloat (ticker, 'Bid'),
            'bidVolume': undefined,
            'ask': this.safeFloat (ticker, 'Ask'),
            'askVolume': undefined,
            'vwap': undefined,
            'open': previous,
            'close': last,
            'last': last,
            'previousClose': undefined,
            'change': change,
            'percentage': percentage,
            'average': undefined,
            'baseVolume': this.safeFloat (ticker, 'Volume'),
            'quoteVolume': this.safeFloat (ticker, 'BaseVolume'),
            'info': ticker,
        };
    }

    async fetchTicker (symbol, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'market': market['id'],
        };
        const response = await this.publicGetMarketsummary (this.extend (request, params));
        //
        //     {
        //         "success":true,
        //         "message":"",
        //         "result": {
        //                 "MarketName":"BTC-ETH",
        //                 "High":0.02127099,
        //                 "Low":0.02035064,
        //                 "Volume":10288.40271571,
        //                 "Last":0.02070510,
        //                 "BaseVolume":214.64663206,
        //                 "TimeStamp":"2019-09-18T21:03:59.897",
        //                 "Bid":0.02070509,
        //                 "Ask":0.02070510,
        //                 "OpenBuyOrders":1228,
        //                 "OpenSellOrders":5899,
        //                 "PrevDay":0.02082823,
        //                 "Created":"2015-08-14T09:02:24.817"
        //             }
        //     }
        //
        const ticker = response['result'];
        return this.parseTicker (ticker, market);
    }
};
