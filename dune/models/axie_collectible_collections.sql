-- Maps a Ronin Axie token_id to the collectible collection(s) it belongs to.
--
-- Collection membership (Mystic, Nightmare, Origin, …) is determined by an
-- Axie's genes/parts, which are not available in a decoded form on-chain, so
-- this is a seed-backed reference table sourced from the Sky Mavis `axies`
-- search. Regenerate the seed with scripts/export-collection-map.mjs in the
-- axie-dashboard repo. MULTI-MEMBERSHIP: a token has one row per collection it
-- belongs to (an Axie can be in two, e.g. Christmas + Nightmare), so grouping by
-- collection counts each independently — matching how Sky Mavis reports them.
--
-- Join to nft.trades / nft.transfers on token_id to attribute sales/holders.

{{ config(
    schema = 'axie',
    alias = 'collectible_collections',
    materialized = 'table',
    tags = ['static', 'axie', 'ronin']
) }}

select distinct
    cast(token_id as varchar) as token_id,
    collection
from {{ ref('axie_collectible_collections_seed') }}
