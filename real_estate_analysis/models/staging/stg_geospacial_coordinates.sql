with source as (
    select
        *,
        st_geomfromtext(geometrie_wkt) as geometrie
    from {{ ref('iris_59') }}
)

select
    code_iris,
    nom_iris,
    nom_commune,
    code_insee,
    iris,
    type_iris,
    geometrie                  as geom,
    st_xmin(geometrie)         as bbox_xmin,
    st_xmax(geometrie)         as bbox_xmax,
    st_ymin(geometrie)         as bbox_ymin,
    st_ymax(geometrie)         as bbox_ymax
from source
where geometrie is not null
  and st_geometrytype(geometrie) = 'MULTIPOLYGON'
