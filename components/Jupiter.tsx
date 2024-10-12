'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection, PublicKey, Transaction, SystemProgram, ComputeBudgetProgram, SYSVAR_RENT_PUBKEY, VersionedTransaction } from '@solana/web3.js'
import { createJupiterApiClient } from '@jup-ag/api'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Loader2, ArrowDownUp, Upload } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { AnchorProvider, BN, Idl, Program } from '@coral-xyz/anchor'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys'
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox'
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters'
import { CREATE_CPMM_POOL_PROGRAM, getCreatePoolKeys, makeCreateAmmConfig, makeCreateCpmmPoolInInstruction, makeInitializeMetadata, METADATA_PROGRAM_ID } from 'tokengobbler'

async function shortenUri(url: string): Promise<string> {
  try {
    const response = await fetch(`http://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`)
    return await response.text()
  } catch (error) {
    console.error('Error shortening URL:', error)
    return url.substring(0, 200)
  }
}

interface TokenInfo {
  address: string;
  programId?: PublicKey;
  balance?: number;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
}

const PROGRAM_IDS = ['CVF4q3yFpyQwV8DLDiJ9Ew6FFLE1vr5ToRzsXYQTaNrj']
const cpmm = new PublicKey('CPMMQ1ELcDDe1DCbMw9YNE1n2MiMbQZgKQYBmZJGBFXh')

export default function JupiterSwapForm() {
  const [programs, setPrograms] = useState<{ [key: string]: Program<any> }>({})
  const [poolExists, setPoolExists] = useState(false)
  const [tokenName, setTokenName] = useState("")
  const [tokenSymbol, setTokenSymbol] = useState("")
  const [tokenDescription, setTokenDescription] = useState("")
  const [tokenImage, setTokenImage] = useState<File | null>(null)
  const jupiterApi = createJupiterApiClient({ basePath: "https://superswap.fomo3d.fun" })

  const wallet = useWallet()
  const [isLoading, setIsLoading] = useState(false)
  const [tokens, setTokens] = useState<TokenInfo[]>([])
  const [allTokens, setAllTokens] = useState<TokenInfo[]>([]);
  const [formValue, setFormValue] = useState({
    amount: "1",
    inputMint: "",
    outputMint: "",
    slippage: 0.5,
  })
  const [quoteResponse, setQuoteResponse] = useState<any>(null)
  const [searchInput, setSearchInput] = useState("")
  const [searchOutput, setSearchOutput] = useState("")

  const inputToken = tokens.find(t => t.address === formValue.inputMint);
  const outputToken = allTokens.find(t => t.address === formValue.outputMint);

  const endpoint = "https://rpc.ironforge.network/mainnet?apiKey=01HRZ9G6Z2A19FY8PR4RF4J4PW"
  const connection = new Connection(endpoint)

  useEffect(() => {
    const fetchTokens = async () => {
      if (!wallet.publicKey) return;

      try {
        // Fetch the user's token balances
        let userTokens: TokenInfo[] = [];
        let page = 1;
        const limit = 100;
        let hasMore = true;

        while (hasMore) {
          const response = await fetch('https://mainnet.helius-rpc.com/?api-key=0d4b4fd6-c2fc-4f55-b615-a23bab1ffc85', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: `page-${page}`,
              method: 'getAssetsByOwner',
              params: {
                ownerAddress: wallet.publicKey.toBase58(),
                page: page,
                limit: limit,
                displayOptions: {
                  showFungible: true
                }
              },
            }),
          });

          const { result } = await response.json();
          
          if (result.items.length === 0) {
            hasMore = false;
          } else {
            const pageTokens = result.items
              .filter((item: any) => item.interface === 'FungibleToken' || item.interface === 'FungibleAsset')
              .map((token: any) => {
                return {
                  address: token.id,
                  balance: token.token_info?.balance || '0',
                  symbol: token.symbol || token.content?.metadata?.symbol || '',
                  name: token.content?.metadata?.name || '',
                  decimals: token.token_info?.decimals || 0,
                  logoURI: token.content?.links?.image || '',
                };
              });

            userTokens = [...userTokens, ...pageTokens];
            
            if (page === 1 && pageTokens.length > 1) {
              setFormValue(prev => ({
                ...prev,
              }));
            }
            
            page++;
          }
        }

        setTokens(userTokens.filter(token => token !== null));

        // Fetch the top tokens for the output token list
        const response = await fetch('/api/tokens?limit=100&offset=0');
        const { tokens: topTokens } = await response.json();
        setAllTokens(topTokens);

        if (userTokens.length > 1) {
          setFormValue(prev => ({
            ...prev,
          }));
        }
      } catch (error) {
        console.error("Failed to fetch tokens:", error);
      }
    };
    fetchTokens()
  }, [wallet.publicKey])
  const [success,setSucess] = useState("")
  const fetchQuote = useCallback(async () => {
    if (formValue.inputMint == "" || formValue.outputMint == "" || !inputToken || !outputToken) return
    setIsLoading(true)
    try {
      const amount = (parseFloat(formValue.amount) * (10 ** inputToken.decimals)).toString()
      const quote = await jupiterApi.quoteGet({
        inputMint: formValue.inputMint,
        outputMint: formValue.outputMint,
        amount: Number(amount),
        slippageBps: formValue.slippage * 100,
      })
      setQuoteResponse(quote)
    } catch (error) {
      console.error("Failed to fetch quote:", error)
    }
    setIsLoading(false)
  }, [formValue, inputToken, outputToken, jupiterApi])

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      if (formValue.inputMint && formValue.outputMint && formValue.amount) {
        fetchQuote()
      }
    }, 500) // Debounce for 500ms

    return () => clearTimeout(debounceTimer)
  }, [formValue.amount, formValue.inputMint, formValue.outputMint, fetchQuote])

  const handleSwap = async () => {
    if (!quoteResponse || !wallet.publicKey || !wallet.signTransaction) return

    try {
      const swapResult = await jupiterApi.swapPost({
        swapRequest: {
        userPublicKey: wallet.publicKey.toBase58(),
        quoteResponse},
      })
      console.log("Swap transaction created:", swapResult)
      // Deserialize the transaction
      const swapTransactionBuf = Buffer.from(swapResult.swapTransaction, 'base64');
      const transaction = await wallet.signTransaction(VersionedTransaction.deserialize(swapTransactionBuf));
      
      // Get the latest blockhash
      const latestBlockhash = await connection.getLatestBlockhash();
      
      // Execute the transaction
      const rawTransaction = transaction.serialize()
      const txid = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 2
      });
      
      // Confirm the transaction
      await connection.confirmTransaction({
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        signature: txid
      });
      
      console.log(`Swap transaction successful: https://solscan.io/tx/${txid}`);
      setSuccess(`Swap transaction successful: https://solscan.io/tx/${txid}`);
    } catch (error) {
      setError(`Swap failed: ${error instanceof Error ? error.message : String(error)}`);
      console.error("Swap failed:", error)
    }
  }
  const [error, setError] = useState("")
  const switchTokens = () => {
    setFormValue(prev => ({
      ...prev,
      inputMint: prev.outputMint,
      outputMint: prev.inputMint,
      amount: quoteResponse ? (parseFloat(quoteResponse.outAmount) / (10 ** outputToken!.decimals)).toString() : prev.amount
    }))
    setSearchInput("")
    setSearchOutput("")
  }

  const formatBalance = (balance: number | undefined, decimals: number) => {
    if (balance === undefined) return "0"
    return (balance / (10 ** decimals)).toFixed(decimals)
  }

  const handleInputSearch = (value: string) => {
    setSearchInput(value);
    // Filter the existing tokens
    if (value.length > 0) {
      const filteredTokens = tokens.filter(token => 
        token.symbol.toLowerCase().includes(value.toLowerCase()) ||
        token.name.toLowerCase().includes(value.toLowerCase())
      );
      setTokens(filteredTokens);
    } else {
      // If search is cleared, reset to original tokens
      setTokens(tokens);
    }
  };

  const handleOutputSearch = async (value: string) => {
    setSearchOutput(value);
    if (value.length > 0) {
      const response = await fetch(`/api/tokens?search=${encodeURIComponent(value)}&limit=1000&offset=0`);
      const { tokens: searchResults } = await response.json();
      setAllTokens(searchResults);
    } else {
      // If search is cleared, reset to top tokens
      const response = await fetch('/api/tokens?limit=1000&offset=0');
      const { tokens: topTokens } = await response.json();
      setAllTokens(topTokens);
    }
  };

  const umi = wallet.publicKey
    ? createUmi(connection.rpcEndpoint)
        .use(irysUploader())
        .use(mplToolbox())
        .use(walletAdapterIdentity(wallet as any))
    : null

  useEffect(() => {
    const fetchPrograms = async () => {
      if (!wallet.publicKey) return;

      const provider = new AnchorProvider(connection, wallet as any, {});
      const fetchedPrograms: { [key: string]: Program<any> } = {};

      for (const programId of PROGRAM_IDS) {
        try {
          const program = new Program(await Program.fetchIdl(new PublicKey(programId), provider) as Idl, provider)
          fetchedPrograms[programId] = program;
        } catch (error) {
          console.error(`Error fetching program ${programId}:`, error);
        }
      }

      setPrograms(fetchedPrograms);
    };

    fetchPrograms();
  }, [wallet.publicKey]);
const [checkedPools, setCheckedPools] = useState<Set<string>>(new Set());

const checkPoolExists = useCallback(async () => {
  if (formValue.inputMint == "" || formValue.outputMint == "" || !inputToken || !outputToken || !wallet.publicKey) return;

  const configId = 0
  const [ammConfigKey, _bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('amm_config'), new BN(configId).toArrayLike(Buffer, 'be', 8)],
    CREATE_CPMM_POOL_PROGRAM
  )
    const poolKeys = getCreatePoolKeys({
    creator: wallet.publicKey,
    programId: CREATE_CPMM_POOL_PROGRAM,
    mintA: new PublicKey(inputToken.address),
    mintB: new PublicKey(outputToken.address),
    configId: ammConfigKey
  })  
console.log(123123)
  try {
    if (checkedPools.has(poolKeys.poolId.toString())) return;
    const poolInfo = await connection.getAccountInfo(poolKeys.poolId)
    setPoolExists(!!poolInfo)
    setCheckedPools(prev => new Set(prev).add(poolKeys.poolId.toString()));
  } catch (error) {
    console.error('Error checking pool existence:', error)
    setPoolExists(false)
    setCheckedPools(prev => new Set(prev).add(poolKeys.poolId.toString()));
  }
}, [inputToken, outputToken]);

  useEffect(() => {
    if (inputToken && outputToken) {
      checkPoolExists();
    }
  }, [inputToken, outputToken]);

  const createGobblerPools = async () => {
    if (!wallet || !wallet.publicKey || !inputToken || !outputToken || !tokenName || !tokenSymbol || !tokenDescription || !tokenImage || !umi) {
      console.error('Missing required data for pool creation')
      return
    }

    try {
      console.log('Creating memecoin...')

      const genericFile = {
        buffer: new Uint8Array(await tokenImage.arrayBuffer()),
        fileName: tokenImage.name,
        displayName: tokenImage.name,
        uniqueName: `${Date.now()}-${tokenImage.name}`,
        contentType: tokenImage.type,
        extension: tokenImage.name.split('.').pop() || '',
        tags: []
      }
      const [imageUri] = await umi.uploader.upload([genericFile])

      const metadata = {
        name: tokenName,
        symbol: tokenSymbol,
        description: tokenDescription,
        seller_fee_basis_points: 500,
        image: imageUri,
        attributes: [],
        properties: {
          files: [
            {
              uri: imageUri,
              type: tokenImage.type
            }
          ],
          category: 'image'
        }
      }

      if (tokenImage.type.startsWith('video/')) {
        
        metadata.properties.category = 'video'
        // @ts-ignore
        metadata.animation_url = imageUri

        const video = document.createElement('video')
        video.src = URL.createObjectURL(tokenImage)
        video.load()

        await new Promise<void>((resolve) => {
          video.onloadeddata = () => {
            video.currentTime = 1

            const canvas = document.createElement('canvas')
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight

            const ctx = canvas.getContext('2d')
            ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)

            const snapshotImageUri = canvas.toDataURL('image/jpeg')

            metadata.properties.files.push({
              uri: snapshotImageUri,
              type: 'image/jpeg'
            })
            resolve()
          }
        })
      } else if (tokenImage.type.startsWith('audio/')) {
        metadata.properties.category = 'audio'
        // @ts-ignore
        metadata.animation_url = imageUri
      }

      const uri = await umi.uploader.uploadJson(metadata)

      const tokenAMint = new PublicKey(inputToken.address)
      const tokenBMint = new PublicKey(outputToken.address)
      const isFront = new BN(tokenAMint.toBuffer()).lte(new BN(tokenBMint.toBuffer()))

      const [mintA, mintB] = isFront ? [tokenAMint, tokenBMint] : [tokenBMint, tokenAMint]
      const amountA = new BN(formValue.amount)
      const amountB = new BN(quoteResponse.outAmount)
      const [tokenAInfo, tokenBInfo] = isFront ? [inputToken, outputToken] : [outputToken, inputToken]
      const [tokenAAmount, tokenBAmount] = isFront ? [amountA, amountB] : [amountB, amountA]
      const configId = 0
      const [ammConfigKey, _bump] = PublicKey.findProgramAddressSync(
        [Buffer.from('amm_config'), new BN(configId).toArrayLike(Buffer, 'be', 8)],
        CREATE_CPMM_POOL_PROGRAM
      )
      const poolKeys = getCreatePoolKeys({
        creator: wallet.publicKey,
        programId: CREATE_CPMM_POOL_PROGRAM,
        mintA,
        mintB,
        configId: ammConfigKey
      })
      poolKeys.configId = ammConfigKey

      // Fetch account info for mintA and mintB to get their program IDs
      const mintAAccountInfo = await connection.getAccountInfo(mintA);
      const mintBAccountInfo = await connection.getAccountInfo(mintB);

      if (!mintAAccountInfo || !mintBAccountInfo) {
        throw new Error("Failed to fetch mint account info");
      }

      // Set the program IDs based on the account owners
      tokenAInfo.programId = mintAAccountInfo.owner;
      tokenBInfo.programId = mintBAccountInfo.owner;
      const startTimeValue = Math.floor(Date.now() / 1000)

      const instructions = [
        makeCreateCpmmPoolInInstruction(
          CREATE_CPMM_POOL_PROGRAM,
          wallet.publicKey,
          ammConfigKey,
          poolKeys.authority,
          poolKeys.poolId,
          mintA,
          mintB,
          poolKeys.lpMint,
          getAssociatedTokenAddressSync(
            mintA,
            wallet.publicKey,
            true,
            (tokenAInfo?.programId || TOKEN_PROGRAM_ID )
          ),
          getAssociatedTokenAddressSync(
            mintB,
            wallet.publicKey,
            true,
            (tokenBInfo?.programId || TOKEN_PROGRAM_ID)
          ),
          getAssociatedTokenAddressSync(poolKeys.lpMint, wallet.publicKey, true, TOKEN_PROGRAM_ID),
          poolKeys.vaultA,
          poolKeys.vaultB,
          (tokenAInfo?.programId || TOKEN_PROGRAM_ID),
          (tokenBInfo?.programId || TOKEN_PROGRAM_ID),
          poolKeys.observationId,
          tokenAAmount,
          tokenBAmount,
          new BN(startTimeValue)
        ),
        makeInitializeMetadata(
          CREATE_CPMM_POOL_PROGRAM,
          wallet.publicKey,
          poolKeys.authority,
          poolKeys.lpMint,
          METADATA_PROGRAM_ID,
          PublicKey.findProgramAddressSync(
            [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), poolKeys.lpMint.toBuffer()],
            METADATA_PROGRAM_ID
          )[0],
          SystemProgram.programId,
          SYSVAR_RENT_PUBKEY,
          ammConfigKey,
          poolKeys.poolId,
          poolKeys.observationId,
          tokenName,
          tokenSymbol,
          await shortenUri(uri)
        )
      ]
      instructions[1].keys.push({
        pubkey: wallet.publicKey,
        isSigner: false,
        isWritable: true
      })


      const tokenAAccount = await getAssociatedTokenAddressSync(mintA, wallet.publicKey, true, tokenAInfo.programId || TOKEN_PROGRAM_ID);
      const tokenBAccount = await getAssociatedTokenAddressSync(mintB, wallet.publicKey, true, tokenBInfo.programId || TOKEN_PROGRAM_ID);
  
      let preInstructions = [];
  
      const tokenAAccountInfo = await connection.getAccountInfo(tokenAAccount);
      if (!tokenAAccountInfo) {
        preInstructions.push(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            tokenAAccount,
            wallet.publicKey,
            mintA,
            tokenAInfo.programId || TOKEN_PROGRAM_ID
          )
        );
      }
  
      const tokenBAccountInfo = await connection.getAccountInfo(tokenBAccount);
      if (!tokenBAccountInfo) {
        preInstructions.push(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            tokenBAccount,
            wallet.publicKey,
            mintB,
            tokenBInfo.programId || TOKEN_PROGRAM_ID
          )
        );
      }
      const transaction = new Transaction().add(...preInstructions, ...instructions).add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 333333 }))
      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.feePayer = wallet.publicKey
      if (!wallet.signTransaction) return
      const signedTransaction = await wallet.signTransaction(transaction)
      const txid = await connection.sendRawTransaction(signedTransaction.serialize())
      await connection.confirmTransaction(txid)

      console.log(`Pool creation successful: https://solscan.io/tx/${txid}`)
      setPoolExists(true)
    } catch (error) {
      console.error('Error creating pool:', error)
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Swap Tokens</CardTitle>
      </CardHeader>
      {success != "" && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded relative mb-4" role="alert">
          <strong className="font-bold">Success!</strong>
          <span className="block sm:inline"> {success}</span>
        </div>
      )}
      {error != ""  && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
          <strong className="font-bold">Error!</strong>
          <span className="block sm:inline"> {error}</span>
        </div>
      )}
      <CardContent>
        <div className="space-y-4">
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700">
              Amount
            </label>
            <Input
              id="amount"
              type="number"
              value={formValue.amount}
              onChange={(e) => setFormValue({ ...formValue, amount: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="inputToken" className="block text-sm font-medium text-gray-700">
              From
            </label>
            <Select
              value={formValue.inputMint}
              onValueChange={(value) => setFormValue({ ...formValue, inputMint: value })}
            >
              <SelectTrigger id="inputToken">
                <SelectValue>
                  {inputToken ? (
                    <div className="flex items-center">
                      <img src={inputToken.logoURI} alt={inputToken.symbol} className="w-5 h-5 mr-2" />
                      <span>{inputToken.symbol}</span>
                    </div>
                  ) : (
                    "Select token"
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <Input
                  placeholder="Search tokens"
                  value={searchInput}
                  onChange={(e) => handleInputSearch(e.target.value)}
                  className="mb-2"
                />
                <ScrollArea className="h-[200px]">
                  {tokens.map((token) => (
                    <SelectItem key={token.address} value={token.address}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <img src={token.logoURI} alt={token.symbol} className="w-5 h-5 mr-2" />
                          <span>{token.symbol}</span>
                        </div>
                        <span className="text-sm text-gray-500">
                          {formatBalance(token.balance, token.decimals)}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </ScrollArea>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-center">
            <Button variant="outline" size="icon" onClick={switchTokens}>
              <ArrowDownUp className="h-4 w-4" />
            </Button>
          </div>
          <div>
            <label htmlFor="outputToken" className="block text-sm font-medium text-gray-700">
              To
            </label>
            <Select
              value={formValue.outputMint}
              onValueChange={(value) => setFormValue({ ...formValue, outputMint: value })}
            >
              <SelectTrigger id="outputToken">
                <SelectValue>
                  {outputToken ? (
                    <div className="flex items-center">
                      <img src={outputToken.logoURI} alt={outputToken.symbol} className="w-5 h-5 mr-2" />
                      <span>{outputToken.symbol}</span>
                    </div>
                  ) : (
                    "Select token"
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <Input
                  placeholder="Search tokens"
                  value={searchOutput}
                  onChange={(e) => handleOutputSearch(e.target.value)}
                  className="mb-2"
                />
                <ScrollArea className="h-[200px]">
                  {allTokens.map((token) => (
                    <SelectItem key={token.address} value={token.address}>
                      <div className="flex items-center">
                        <img src={token.logoURI} alt={token.symbol} className="w-5 h-5 mr-2" />
                        <span>{token.symbol}</span>
                      </div>
                    </SelectItem>
                  ))}
                </ScrollArea>
              </SelectContent>
            </Select>
          </div>
          {quoteResponse && (
            <div className="text-sm">
              <p>
                Output:{" "}
                {(parseFloat(quoteResponse.outAmount) / 10 ** outputToken!.decimals).toFixed(
                  outputToken!.decimals
                )}{" "}
                {outputToken!.symbol}
              </p>
              <p>Price Impact: {quoteResponse.priceImpactPct.toFixed(2)}%</p>
            </div>
          )}
        </div>
      </CardContent>
      {inputToken && outputToken && quoteResponse && (
        <div className="mt-4 text-sm">
          <p className="font-semibold">Token Ratio:</p>
          <p>
            {inputToken.symbol}/{outputToken.symbol}:{' '}
            {(parseFloat(quoteResponse.outAmount) / (10 ** outputToken.decimals) / parseFloat(formValue.amount)).toFixed(6)}
          </p>
          <p>
            {outputToken.symbol}/{inputToken.symbol}:{' '}
            {(parseFloat(formValue.amount) / (parseFloat(quoteResponse.outAmount) / (10 ** outputToken.decimals))).toFixed(6)}
          </p>
        </div>
      )}
      <CardFooter>
        {!poolExists && inputToken && outputToken ? (
          <div className="w-full space-y-4">
            <p className="text-center">Gobbler pool does not exist. Create it if you want. The token ratio is the initial price, be careful...</p>
            <div>
              <label htmlFor="tokenName" className="block text-sm font-medium text-gray-700">
                Token Name
              </label>
              <Input
                id="tokenName"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="Enter token name"
              />
            </div>
            <div>
              <label htmlFor="tokenSymbol" className="block text-sm font-medium text-gray-700">
                Token Symbol
              </label>
              <Input
                id="tokenSymbol"
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value)}
                placeholder="Enter token symbol"
              />
            </div>
            <div>
              <label htmlFor="tokenDescription" className="block text-sm font-medium text-gray-700">
                Token Description
              </label>
              <Input
                id="tokenDescription"
                value={tokenDescription}
                onChange={(e) => setTokenDescription(e.target.value)}
                placeholder="Enter token description"
              />
            </div>
            <div>
              <label htmlFor="tokenImage" className="block text-sm font-medium text-gray-700">
                Token Image
              </label>
              <input
                id="tokenImage"
                type="file"
                accept="image/*"
                onChange={(e) => setTokenImage(e.target.files?.[0] || null)}
                className="mt-1"
              />
            </div>
            <Button onClick={createGobblerPools} className="w-full">
              Create Pool
            </Button>
          </div>
        ) : (
          <Button onClick={handleSwap} disabled={!quoteResponse || isLoading} className="w-full">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              "Swap"
            )}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}