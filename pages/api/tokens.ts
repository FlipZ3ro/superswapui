import { NextApiRequest, NextApiResponse } from 'next';
import NodeCache from 'node-cache';

const TOP_TOKENS_URL = 'https://cache.jup.ag/top-tokens';
const ALL_TOKENS_URL = 'https://cache.jup.ag/all-tokens';

interface TokenInfo {
  address: string;
  chainId: number;
  decimals: number;
  name: string;
  symbol: string;
  logoURI: string;
  tags: string[];
  extensions: {
    coingeckoId?: string;
  };
}

const cache = new NodeCache({ stdTTL: 30000 }); // 5 minutes TTL

async function fetchTokens(): Promise<TokenInfo[]> {
  try {
    const response = await fetch(ALL_TOKENS_URL);
    if (!response.ok) {
      throw new Error('Failed to fetch token list');  
    }
    const data = await response.json();
    if (!data || !Array.isArray(data)) {
      throw new Error('Invalid token data received');
    }
    return data;
  } catch (error) {
    console.error('Error fetching tokens:', error);
    return [];
  }
}

async function updateCache() {
  try {
    const tokens = await fetchTokens();
    if (tokens.length > 0) {
      cache.set('allTokens', tokens);
      
      // Pre-fetch and cache top tokens
      const topTokensResponse = await fetch(TOP_TOKENS_URL);
      if (topTokensResponse.ok) {
        const topTokenAddresses: string[] = await topTokensResponse.json();
        const topTokens = tokens.filter(token => topTokenAddresses.includes(token.address));
        cache.set('topTokens', topTokens);
      }
      
      console.log('Token cache updated');
    } else {
      console.error('No tokens fetched, cache not updated');
    }
  } catch (error) {
    console.error('Failed to update token cache:', error);
  }
}

// Start the cache update loop
setInterval(updateCache, 5 * 60 * 1000); // 5 minutes

// Initial cache update
updateCache();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const { search, limit = '10', offset = '0' } = req.query;
      const limitNum = parseInt(limit as string, 10);
      const offsetNum = parseInt(offset as string, 10);

      let tokens: TokenInfo[];

      if (search) {
        tokens = cache.get('allTokens') as TokenInfo[] || await fetchTokens();
        
        const searchLower = (search as string).toLowerCase();
        tokens = tokens.filter(token => 
          token.name.toLowerCase().includes(searchLower) ||
          token.symbol.toLowerCase().includes(searchLower)
        );
      } else {
        tokens = cache.get('topTokens') as TokenInfo[] || [];
        if (tokens.length === 0) {
          const allTokens = cache.get('allTokens') as TokenInfo[] || await fetchTokens();
          const topTokensResponse = await fetch(TOP_TOKENS_URL);
          if (topTokensResponse.ok) {
            const topTokenAddresses: string[] = await topTokensResponse.json();
            tokens = allTokens.filter(token => topTokenAddresses.includes(token.address));
            cache.set('topTokens', tokens);
          } else {
            tokens = allTokens;
          }
        }
      }

      // Apply pagination
      const paginatedTokens = tokens.slice(offsetNum, offsetNum + limitNum);

      res.status(200).json({
        tokens: paginatedTokens,
        total: tokens.length,
        limit: limitNum,
        offset: offsetNum
      });
    } catch (error) {
      console.error('Error serving tokens:', error);
      res.status(500).json({ error: 'Failed to retrieve tokens' });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
