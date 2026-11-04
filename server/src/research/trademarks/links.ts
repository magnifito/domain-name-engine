export type TrademarkOffice = 'uspto' | 'euipo' | 'tmview' | 'wipo';

export interface SearchLink {
  office: TrademarkOffice;
  url: string;
  note: string;
}

/** Direct search links for a manual check. These are web pages for people, never fetched. */
export function trademarkSearchLinks(mark: string): SearchLink[] {
  const q = encodeURIComponent(mark.trim());
  return [
    {
      office: 'uspto',
      url: `https://tmsearch.uspto.gov/search/search-results?query=${q}&section=default`,
      note: 'USPTO Trademark Search (United States)',
    },
    {
      office: 'euipo',
      url: `https://euipo.europa.eu/eSearch/#basic/1+1+1+1/100+100+100+100/${q}`,
      note: 'EUIPO eSearch plus (EU trade marks)',
    },
    {
      office: 'tmview',
      url: `https://www.tmdn.org/tmview/#/tmview/results?page=1&pageSize=30&criteria=C&basicSearch=${q}`,
      note: 'TMview (EU national offices and partner offices)',
    },
    {
      office: 'wipo',
      url: 'https://branddb.wipo.int/en/quicksearch',
      note: `WIPO Global Brand Database: search the brand name "${mark.trim()}"`,
    },
  ];
}
