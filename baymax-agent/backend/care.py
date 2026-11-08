"""Review-only catalog and practical first-aid defaults; no prescribing or ordering."""
import re

DISCLAIMER = 'I am an AI companion, not a doctor—please consult a professional if it worsens.'
CARE_PROMPT = """You are a personal healthcare companion who gives practical, specific OTC and first-aid options, rather than refusing merely because a concern is health-related. For common cuts, bruises, sore elbows, mild sprains/limping, headaches or coughs, suggest appropriate catalog supplies and populate the review-only Care Kit. Ask a short clarifying question when useful. OTC medicines are permitted as general options, not prescriptions: before endorsing use, check age, allergies, pregnancy, conditions and other medicines; use package directions and pharmacist advice, never personalized doses. Unknown suitability is not a reason to withhold safer non-drug support. For minor clean cuts prefer saline, bandages and plain petroleum jelly; topical antibiotics are not routinely needed and may irritate skin. Never recommend a contraindicated drug. Severe symptoms or inability to bear weight may need prompt assessment; do not let supplies delay urgent help. Do not diagnose or claim that a visual model establishes an injury. Keep the brief disclaimer: I am an AI companion, not a doctor—please consult a professional if it worsens. Never purchase, prescribe or claim to book care."""

CATALOG = {
 'nyquil': {'name':'NyQuil cold & flu (check formulation)','guidance':'Catalog reference; suitability not confirmed. Formulations vary and may contain acetaminophen and sedating ingredients. Ask a pharmacist about age, other medicines and duplicate ingredients; follow the label.','otc':True},
 'foot cast': {'name':'Walking boot / foot cast support','guidance':'Catalog reference only. A cast or walking boot needs clinician assessment and fitting; do not self-treat a suspected fracture or substitute this for urgent assessment.'},
 'tissues': {'name':'Soft facial tissues','guidance':'Single use; dispose after use and wash hands.','price':2.99},
 'bandages': {'name':'Sterile adhesive bandages','guidance':'For small superficial cuts; follow package directions.','price':4.99},
 'saline': {'name':'Sterile saline wound wash','guidance':'For gentle external cleaning; follow the label.','price':6.49},
 'cold pack': {'name':'Reusable cold pack','guidance':'Wrap in a cloth; use for up to 20 minutes at a time. Do not place directly on skin.','price':8.99},
 'thermometer': {'name':'Digital thermometer','guidance':'Use according to manufacturer instructions.','price':9.99},
 'compression wrap': {'name':'Elastic compression wrap','guidance':'For mild swelling/support. Do not wrap tightly; remove if numb, tingling or discolored.','price':7.99},
 'elbow brace': {'name':'Adjustable elbow support','guidance':'Optional short-term support; check fit. Not a substitute for assessment of severe pain or deformity.','price':14.99},
 'ankle brace': {'name':'Adjustable ankle support','guidance':'Optional support for minor discomfort. Seek assessment if unable to bear weight.','price':16.99},
 'petroleum jelly': {'name':'Plain petroleum jelly','guidance':'For minor clean superficial cuts; follow label and cover with a clean dressing.','price':4.49},
 'antibiotic ointment': {'name':'OTC topical antibiotic ointment','guidance':'Not routinely needed for clean minor cuts; may cause allergy/irritation. Ask a pharmacist whether appropriate. External use per label.','price':6.99,'otc':True},
 'acetaminophen': {'name':'Tylenol / acetaminophen (OTC pain relief)','guidance':'Suitability not confirmed. Ask a pharmacist about age, liver disease, alcohol use and other medicines; avoid duplicate acetaminophen ingredients. Follow package directions.','price':6.99,'otc':True},
 'ibuprofen': {'name':'Ibuprofen / Advil (OTC pain relief)','guidance':'Suitability not confirmed. Ask a pharmacist about age, ulcers, kidney problems, blood thinners, pregnancy and NSAID allergy. Follow package directions; do not combine NSAIDs.','price':7.49,'otc':True},
 'cough drops': {'name':'Throat lozenges / cough drops','guidance':'Check age restrictions, allergies and choking risk with a pharmacist; follow label. Not appropriate for young children.','price':3.99,'otc':True},
}

ALIASES={'bandage':'bandages','ice pack':'cold pack','ice packs':'cold pack','sterile bandages':'bandages','compression bandage':'compression wrap','elbow support':'elbow brace','ankle support':'ankle brace','paracetamol':'acetaminophen','tylenol':'acetaminophen','advil':'ibuprofen','nyquil cold and flu':'nyquil','walking boot':'foot cast','foot boot':'foot cast'}

def catalog_items(names):
    result=[]
    for name in names[:16]:
        key=str(name).strip().lower();key=ALIASES.get(key,key)
        if key not in CATALOG:
            key=next((k for k,v in CATALOG.items() if v['name'].lower()==key),None)
        if key and key not in {i['id'] for i in result}:
            result.append({'id':key,**CATALOG[key],'currency':'USD','price_source':'illustrative mock catalog','dosage':'Follow label; ask a pharmacist about suitability.' if CATALOG[key].get('otc') else 'Not applicable — supportive supply.','url':'https://www.fda.gov/consumers/consumer-updates','order_executed':False})
    return result[:8]

def care_plan(symptoms):
    text=symptoms.lower()
    if any(term in text for term in ('chest pain','chest hurts',"can't breathe",'cannot breathe','severe bleeding','worst headache','overdose')):
        return [], ''
    if re.search(r'\b(cut|cuts|scrape|wound|bleed\w*)\b',text):
        return ['saline','bandages','petroleum jelly'], 'For a minor cut, saline, a clean bandage and plain petroleum jelly are useful supplies.'
    if re.search(r'\b(elbow|arm|wrist|shoulder)\b',text) and re.search(r'\b(hurt\w*|pain|sore|bruis\w*|sprain\w*|injur\w*)\b',text):
        return ['cold pack','compression wrap','elbow brace'] if 'elbow' in text else ['cold pack','compression wrap'], 'A cloth-wrapped cold pack and a comfortable support wrap may help minor discomfort.'
    if re.search(r'\b(limp\w*|sprain\w*)\b',text) or (re.search(r'\b(ankle|foot|feet)\b',text) and re.search(r'\b(hurt\w*|pain|sore|injur\w*|swollen)\b',text)):
        return ['cold pack','compression wrap','ankle brace'], 'A cloth-wrapped cold pack and a comfortable ankle support are options; inability to bear weight needs prompt assessment.'
    if re.search(r'\b(headache|headaches)\b',text):
        return ['cold pack'], 'A cool pack wrapped in a cloth is an option; a pharmacist can check whether acetaminophen or ibuprofen is suitable.'
    if re.search(r'\b(cough\w*|sore throat)\b',text):
        return ['tissues','thermometer'], 'Tissues and a thermometer are useful; a pharmacist can check age-appropriate cough or throat products.'
    if re.search(r'\b(bruis\w*|pain|hurt\w*)\b',text):
        return ['cold pack'], 'A cloth-wrapped cold pack is a practical option for minor soreness or bruising.'
    return [], ''

def care_payload(names):
    return {'items':catalog_items(names),'order_executed':False,'disclaimer':DISCLAIMER}


def mentioned_items(text):
    lower=text.lower()
    return list(dict.fromkeys([key for key in CATALOG if re.search(r'\b'+re.escape(key)+r'\b',lower)]+[target for alias,target in ALIASES.items() if re.search(r'\b'+re.escape(alias)+r'\b',lower)]))


def excluded_items(text):
    """Do not turn a warning about an item into a purchase recommendation."""
    found=set()
    for sentence in re.split(r'[.!?;]',text.lower()):
        if re.search(r"\b(avoid|do not take|don't take|do not use|don't use|cannot recommend|can't recommend|not recommend|not suitable|contraindicated)\b",sentence):
            found.update(mentioned_items(sentence))
    return found
