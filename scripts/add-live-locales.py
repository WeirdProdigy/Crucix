"""Maintain public-source UI copy alongside the existing locale dictionaries."""
from pathlib import Path
import json

copy = {
    'en': {'title':'Current public data','help':'Only records within each provider’s freshness window are shown. Forecasts and model estimates are labelled.','providerTime':'Provider time','forecastFor':'Forecast for','startsAt':'Starts at','validUntil':'Valid until','records':'current records','noRecords':'No current records in the watched scope','expired':'Provider data expired or its timestamp is unknown. Live records are hidden.','unavailable':'Source unavailable','ok':'Current','error':'Unavailable','stale':'Expired','showRecords':'Show records','original':'Original source','waiting':'Waiting for the first collection'},
    'hu': {'title':'Friss nyilvános adatok','help':'Csak a forrásonkénti frissességi határon belüli rekordok látszanak. Az előrejelzést és a modellbecslést külön jelöljük.','providerTime':'Forrás adatideje','forecastFor':'Előrejelzés erre az időre','startsAt':'Kezdőidő','validUntil':'Érvényes eddig','records':'friss rekord','noRecords':'Nincs aktuális rekord a figyelt adatkörben','expired':'A forrás adatai lejártak vagy az adatidejük ismeretlen. Az élő rekordokat elrejtettük.','unavailable':'A forrás nem elérhető','ok':'Friss','error':'Nem elérhető','stale':'Lejárt','showRecords':'Rekordok megnyitása','original':'Eredeti forrás','waiting':'Várakozás az első adatgyűjtésre'},
    'fr': {'title':'Données publiques récentes','help':'Seules les données respectant la limite de fraîcheur de chaque source sont affichées. Les prévisions et estimations sont identifiées.','providerTime':'Date des données','forecastFor':'Prévision pour','startsAt':'Début','validUntil':'Valable jusqu’au','records':'données récentes','noRecords':'Aucune donnée actuelle dans le périmètre suivi','expired':'Données expirées ou date inconnue. Les données en direct sont masquées.','unavailable':'Source indisponible','ok':'Récent','error':'Indisponible','stale':'Expiré','showRecords':'Afficher les données','original':'Source originale','waiting':'En attente de la première collecte'},
}
kinds = {
    'en':['Natural event','Space weather','Economy / reference rate','Forecast','Routing / connectivity','Cyber risk'],
    'hu':['Természeti esemény','Űridőjárás','Gazdaság / referenciaárfolyam','Előrejelzés','Útvonalválasztás / kapcsolat','Kiberkockázat'],
    'fr':['Événement naturel','Météo spatiale','Économie / taux de référence','Prévision','Routage / connectivité','Risque cyber'],
}
for lang, values in copy.items():
    path=Path('locales')/(lang+'.json')
    data=json.loads(path.read_text(encoding='utf-8-sig'))
    data['liveSources']=values
    data['map']['disaster']=kinds[lang][0]
    for kind,value in zip(['disaster','space-weather','economic','forecast','network','cyber'],kinds[lang]):
        data['intelligence']['kind_'+kind]=value
    for key,copy_key in [('forecastAt','forecastFor'),('startsAt','startsAt'),('validUntil','validUntil')]:
        data['intelligence'][key]=values[copy_key]
    data['intelligence']['method_forecast-grid']={'en':'Forecast grid point','hu':'Előrejelzési rácspont','fr':'Point de grille de prévision'}[lang]
    data['intelligence']['method_configured-point']={'en':'Configured forecast location','hu':'Beállított előrejelzési hely','fr':'Lieu de prévision configuré'}[lang]
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
