import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate'
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing'
import { GasPrice } from '@cosmjs/stargate'
import axios from 'axios'
import { Command } from 'commander'
import * as dotenv from 'dotenv'
import FormData from 'form-data'
import puppeteer from 'puppeteer'

// Load .env.
dotenv.config()

// Parse arguments.
const program = new Command()
program.option('-a, --address', 'print wallet address')
program.option('-r, --rpc <host:port>', 'RPC endpoint', process.env.RPC)
program.option(
  '-p, --prefix <prefix>',
  'Prefix for the wallet',
  process.env.CHAIN_BECH32_PREFIX
)
program.option(
  '-m, --mnemonic <mnemonic>',
  'Wallet mnemonic to use. Input "NEW" to generate a new mnemonic.',
  process.env.MNEMONIC
)
program.option(
  '-d, --destination <address>',
  'Address to send fish to',
  process.env.DESTINATION
)
program.option(
  '-c, --cw721 <address>',
  'CW721 address to mint fish',
  process.env.CW721
)
program.option(
  '-e, --explorer <URL>',
  'Explorer TX URL base',
  process.env.EXPLORER
)
program.parse()
const options = program.opts()

// Start.
const main = async () => {
  // Create mnemonic if needed.
  if (options.mnemonic === 'NEW') {
    const wallet = await DirectSecp256k1HdWallet.generate(24, {
      prefix: options.prefix,
    })
    const [account] = await wallet.getAccounts()
    console.log(
      `Address\n-------\n${account.address}\n\nMnemonic\n--------\n${wallet.mnemonic}\n`
    )
    return
  }

  // Get wallet.
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(options.mnemonic, {
    prefix: options.prefix,
  })
  const [account] = await wallet.getAccounts()

  // Print address if needed.
  if (options.address) {
    console.log(account.address)
    return
  }

  // Ensure we only try to get a fish at 11:11 am/pm.
  const now = new Date()
  if (
    (now.getHours() !== 11 && now.getHours() !== 23) ||
    now.getMinutes() !== 11
  ) {
    console.log('the time is not 11:11')
    return
  }

  console.log('Connecting to chain...')

  const client = await SigningCosmWasmClient.connectWithSigner(
    options.rpc,
    wallet,
    {
      gasPrice: GasPrice.fromString('0.025ujuno'),
    }
  )

  // Count existing fish.
  const { count } = await client.queryContractSmart(options.cw721, {
    num_tokens: {},
  })
  if (typeof count !== 'number') {
    throw new Error('Invalid count')
  }

  console.log('Getting fish...')

  // Get the fish.
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  await page.goto('http://makea.fish')
  const fish = (await page.screenshot({
    clip: {
      x: 200,
      y: 9,
      width: 400,
      height: 256,
    },
  })) as Buffer
  await browser.close()

  console.log('Uploading fish...')

  // Upload the fish.
  const form = new FormData()
  const id = count + 1
  form.append('name', `fish ${id}`)
  form.append('description', `became a fish at ${now.toLocaleString()}`)
  form.append('image', fish, { filename: 'fish.png' })
  form.append(
    'extra',
    JSON.stringify({
      properties: {
        timestamp: now.getTime(),
      },
    })
  )

  const response = await axios.post(
    'https://testnet.daodao.zone/api/uploadNft',
    form
  )
  const { metadataUrl } = response.data
  if (typeof metadataUrl !== 'string') {
    throw new Error('Invalid metadata URL')
  }

  console.log('Sending fish...')

  // Mint the fish.
  const mintMsg = {
    mint: {
      token_id: `fish_${id}`,
      owner: options.destination,
      token_uri: metadataUrl,
    },
  }
  const tx = await client.execute(
    account.address,
    options.cw721,
    mintMsg,
    'auto',
    undefined,
    []
  )

  console.log(
    `Minted fish ${id} and sent to ${options.destination} in transaction ${tx.transactionHash}:\n${options.explorer}${tx.transactionHash}`
  )
}

main()
