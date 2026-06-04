-- Maps a Ronin Axie token_id to its collectible collection.
--
-- Collection membership (Mystic, Nightmare, Origin, …) is determined by an
-- Axie's genes/parts, which are not available in a decoded form on-chain, so
-- this is a seed-backed reference table sourced from the Sky Mavis `axies`
-- search. Regenerate the seed with scripts/export-collection-map.mjs in the
-- axie-dashboard repo. Each token is assigned to a single collection by the
-- priority Mystic > Origin > MEO > Shiny > Nightmare > Summer > Japanese > Christmas.
--
-- Join to nft.trades on token_id to attribute Axie sales to a collection.

{{ config(
    schema = 'axie',
    alias = 'collectible_collections',
    materialized = 'table',
    tags = ['static', 'axie', 'ronin']
) }}

select
    cast(token_id as varchar) as token_id,
    collection
from {{ ref('axie_collectible_collections_seed') }}
