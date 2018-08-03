const asyncAuto = require('async/auto');

const {Block} = require('./../tokenslib');
const {getFullBlock} = require('./../chain');
const {getJsonFromCache} = require('./../cache');
const {getTransaction} = require('./../chain');
const {returnResult} = require('./../async-util');
const {setJsonInCache} = require('./../cache');

const cacheResultMs = 1000 * 60 * 10;
const lastBlock = {};
const typeBlock = 'get_transaction_block'
const typeTx = 'get_transaction_tx';

/** Get a raw transaction, with an optional cached result

  {
    [block]: <Block Hash Hex String>
    [cache]: <Cache Type String>
    id: <Transaction Id String>
    network: <Network Name String>
  }

  @returns via cbk
  {
    [transaction]: <Transaction Hex String>
  }
*/
module.exports = ({block, cache, id, network}, cbk) => {
  return asyncAuto({
    // Check arguments
    validate: cbk => {
      if (!id) {
        return cbk([400, 'ExpectedIdForTransaction']);
      }

      if (!network) {
        return cbk([400, 'ExpectedNetworkToLookForTransaction']);
      }

      return cbk();
    },

    // Get the cached transaction
    getCachedTx: ['validate', ({}, cbk) => {
      // Exit early when a block is provided or there is no cache
      if (!!block || !cache) {
        return cbk();
      }

      return getJsonFromCache({cache, key: id, type: typeTx}, cbk);
    }],

    // Get the cached block
    getCachedBlock: ['getCachedTx', ({getCachedTx}, cbk) => {
      if (!block || !cache) {
        return cbk();
      }

      if (!!getCachedTx && !!getCachedTx.transaction) {
        return cbk();
      }

      lastBlock[network] = lastBlock[network] || {};

      if (lastBlock[network].id === block && !!lastBlock[network].block) {
        return cbk(null, {block: lastBlock[network].block});
      }

      // Last block doesn't match the block we're looking at, wipe "lastBlock"
      lastBlock[network] = {};

      return getJsonFromCache({cache, key: block, type: typeBlock}, cbk);
    }],

    // Get a fresh block
    getFreshBlock: ['getCachedBlock', ({getCachedBlock}, cbk) => {
      if (!block || (!!getCachedBlock && getCachedBlock.block)) {
        return cbk();
      }

      return getFullBlock({network, id: block}, cbk);
    }],

    // Get a fresh transaction
    getFreshTx: ['getCachedTx', ({getCachedTx}, cbk) => {
      if (!!block || (!!getCachedTx && !!getCachedTx.transaction)) {
        return cbk();
      }

      return getTransaction({id, network}, cbk);
    }],

    // Set the cached block into the cache
    setCachedBlock: [
      'getCachedBlock',
      'getFreshBlock',
      ({getCachedBlock, getFreshBlock}, cbk) =>
    {
      // Exit early when we already have a cached value
      if (!!getCachedBlock && !!getCachedBlock.block) {
        return cbk();
      }

      // Exit early when we don't have a fresh block or cache
      if (!cache || !getFreshBlock || !getFreshBlock.block) {
        return cbk();
      }

      return setJsonInCache({
        cache,
        key: block,
        ms: cacheResultMs,
        type: typeBlock,
        value: {block: getFreshBlock.block},
      },
      cbk);
    }],

    // Set the fresh transaction result into the cache
    setCachedTx: [
      'getCachedTx',
      'getFreshTx',
      ({getCachedTx, getFreshTx}, cbk) =>
    {
      // Exit early when this is an in-block lookup or there's no cache set
      if (!!block || !cache) {
        return cbk();
      }

      // Exit early when we already have a cached value
      if (!!getCachedTx && !!getCachedTx.transaction) {
        return cbk()
      }

      // Exit early when the transaction was not found
      if (!getFreshTx || !getFreshTx.transaction) {
        return cbk();
      }

      return setJsonInCache({
        cache,
        key: id,
        ms: cacheResultMs,
        type: typeTx,
        value: {transaction: getFreshTx.transaction},
      },
      cbk);
    }],

    // Transaction found in block
    txInBlock: [
      'getCachedBlock',
      'getFreshBlock',
      ({getCachedBlock, getFreshBlock}, cbk) =>
    {
      const result = getFreshBlock || getCachedBlock;

      // Exit early when there's no block result to look for a tx in
      if (!block || !result || !result.block) {
        return cbk();
      }

      const hexBlock = result.block;

      try {
        const cachedTx = lastBlock[network].transactions;

        const transactions = cachedTx || Block.fromHex(hexBlock).transactions;

        lastBlock[network].block = result.block;
        lastBlock[network].id = block;

        if (!cachedTx) {
          lastBlock[network].transactions = transactions;
        }

        const tx = transactions.find(t => t.getId());

        if (!tx) {
          return cbk([400, 'TransactionNotFoundInBlock']);
        }

        return cbk(null, tx.toHex());
      } catch (err) {
        return cbk([503, 'FailedToDeriveTransactionsFromBlock', err]);
      }
    }],

    // Final result
    result: [
      'getCachedTx',
      'getFreshTx',
      'txInBlock',
      ({getCachedTx, getFreshTx, txInBlock}, cbk) =>
    {
      if (!!txInBlock) {
        return cbk(null, {transaction: txInBlock});
      } else {
        const {transaction} = getFreshTx || getCachedTx;

        return cbk(null, {transaction});
      }
    }],
  },
  returnResult({of: 'result'}, cbk));
};
