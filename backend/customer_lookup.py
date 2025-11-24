"""
Customer Data Lookup Functions
Provides functions for the agent to search and retrieve customer information
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)

# Global cache for customer data
_customer_data_cache = None


def load_customer_data() -> Dict[str, Any]:
    """Load all customer data from JSON files into memory."""
    global _customer_data_cache
    
    if _customer_data_cache is not None:
        return _customer_data_cache
    
    data_dir = Path(__file__).parent / "data"
    customer_data = {
        "bank_customers": [],
        "general_insurance_customers": [],
        "life_insurance_customers": [],
        "auto_insurance_customers": [],
        "trade_customers": []
    }
    
    try:
        # Load bank customers
        bank_file = data_dir / "bank_customers.json"
        if bank_file.exists():
            with open(bank_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                customer_data["bank_customers"] = data.get("customers", [])
        
        # Load general insurance customers
        general_ins_file = data_dir / "general_insurance_customers.json"
        if general_ins_file.exists():
            with open(general_ins_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                customer_data["general_insurance_customers"] = data.get("customers", [])
        
        # Load life insurance customers
        life_ins_file = data_dir / "life_insurance_customers.json"
        if life_ins_file.exists():
            with open(life_ins_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                customer_data["life_insurance_customers"] = data.get("customers", [])
        
        # Load auto insurance customers
        auto_ins_file = data_dir / "auto_insurance_customers.json"
        if auto_ins_file.exists():
            with open(auto_ins_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                customer_data["auto_insurance_customers"] = data.get("customers", [])
        
        # Load trade customers
        trade_file = data_dir / "trade_customers.json"
        if trade_file.exists():
            with open(trade_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                customer_data["trade_customers"] = data.get("customers", [])
        
        _customer_data_cache = customer_data
        logger.info("Customer data loaded successfully")
        
    except Exception as e:
        logger.error(f"Failed to load customer data: {str(e)}")
    
    return customer_data


def search_customer_by_phone(phone: str) -> Dict[str, Any]:
    """
    Search for a customer by phone number across all databases.
    
    Args:
        phone: Phone number to search for (e.g., "+91-9876543210" or "9876543210")
    
    Returns:
        Dictionary containing customer information from all divisions
    """
    customer_data = load_customer_data()
    result = {
        "found": False,
        "phone": phone,
        "bank": None,
        "general_insurance": None,
        "life_insurance": None,
        "auto_insurance": None,
        "trade": None
    }
    
    # Normalize phone number for comparison
    normalized_phone = phone.replace("+91-", "").replace("-", "").replace(" ", "")
    
    # Search in bank customers
    for customer in customer_data["bank_customers"]:
        cust_phone = customer.get("personal_info", {}).get("phone", "").replace("+91-", "").replace("-", "").replace(" ", "")
        if normalized_phone in cust_phone or cust_phone in normalized_phone:
            result["bank"] = customer
            result["found"] = True
    
    # Search in general insurance
    for customer in customer_data["general_insurance_customers"]:
        cust_phone = customer.get("personal_info", {}).get("phone", "").replace("+91-", "").replace("-", "").replace(" ", "")
        if normalized_phone in cust_phone or cust_phone in normalized_phone:
            result["general_insurance"] = customer
            result["found"] = True
    
    # Search in life insurance
    for customer in customer_data["life_insurance_customers"]:
        cust_phone = customer.get("personal_info", {}).get("phone", "").replace("+91-", "").replace("-", "").replace(" ", "")
        if normalized_phone in cust_phone or cust_phone in normalized_phone:
            result["life_insurance"] = customer
            result["found"] = True
    
    # Search in auto insurance
    for customer in customer_data["auto_insurance_customers"]:
        cust_phone = customer.get("personal_info", {}).get("phone", "").replace("+91-", "").replace("-", "").replace(" ", "")
        if normalized_phone in cust_phone or cust_phone in normalized_phone:
            result["auto_insurance"] = customer
            result["found"] = True
    
    # Search in trade
    for customer in customer_data["trade_customers"]:
        cust_phone = customer.get("personal_info", {}).get("phone", "").replace("+91-", "").replace("-", "").replace(" ", "")
        if normalized_phone in cust_phone or cust_phone in normalized_phone:
            result["trade"] = customer
            result["found"] = True
    
    return result


def search_customer_by_name(name: str) -> List[Dict[str, Any]]:
    """
    Search for customers by name (fuzzy matching) across all databases.
    
    Args:
        name: Customer name to search for
    
    Returns:
        List of matching customers with their information
    """
    customer_data = load_customer_data()
    results = []
    
    name_lower = name.lower()
    
    # Search in all databases
    for db_name, customers in customer_data.items():
        for customer in customers:
            personal_info = customer.get("personal_info", {})
            first_name = personal_info.get("first_name", "").lower()
            last_name = personal_info.get("last_name", "").lower()
            full_name = f"{first_name} {last_name}"
            
            if name_lower in full_name or full_name in name_lower:
                results.append({
                    "database": db_name,
                    "customer": customer
                })
    
    return results


def get_customer_summary(phone: str) -> str:
    """
    Get a formatted summary of customer's accounts across all divisions.
    
    Args:
        phone: Customer's phone number
    
    Returns:
        Formatted text summary of customer information
    """
    result = search_customer_by_phone(phone)
    
    if not result["found"]:
        return f"No customer found with phone number: {phone}"
    
    summary = []
    
    # Get customer name from any available record
    customer_name = "Customer"
    for key in ["bank", "general_insurance", "life_insurance", "auto_insurance", "trade"]:
        if result[key]:
            personal_info = result[key].get("personal_info", {})
            customer_name = f"{personal_info.get('first_name', '')} {personal_info.get('last_name', '')}"
            break
    
    summary.append(f"📋 Customer Profile: {customer_name}")
    summary.append(f"📞 Phone: {phone}\n")
    
    # Bank information
    if result["bank"]:
        bank = result["bank"]
        summary.append("🏦 **BANK ACCOUNTS:**")
        accounts = bank.get("accounts", [])
        for acc in accounts:
            summary.append(f"  • {acc.get('account_type')} Account: {acc.get('account_number')}")
            summary.append(f"    Balance: ₹{acc.get('balance', 0):,.2f}")
        
        loans = bank.get("loans", [])
        if loans:
            summary.append("\n  💳 **Loans:**")
            for loan in loans:
                summary.append(f"  • {loan.get('loan_type')}: ₹{loan.get('outstanding_balance', 0):,.2f}")
        
        cards = bank.get("credit_cards", [])
        if cards:
            summary.append("\n  💳 **Credit Cards:**")
            for card in cards:
                summary.append(f"  • {card.get('card_type')}: Limit ₹{card.get('credit_limit', 0):,.2f}")
    
    # Insurance information
    if result["general_insurance"] or result["life_insurance"] or result["auto_insurance"]:
        summary.append("\n🛡️ **INSURANCE POLICIES:**")
        
        if result["general_insurance"]:
            policies = result["general_insurance"].get("policies", [])
            for policy in policies:
                summary.append(f"  • General: {policy.get('policy_number')} - {policy.get('policy_type')}")
                summary.append(f"    Coverage: ₹{policy.get('sum_insured', 0):,.2f}")
        
        if result["life_insurance"]:
            policies = result["life_insurance"].get("policies", [])
            for policy in policies:
                summary.append(f"  • Life: {policy.get('policy_number')} - {policy.get('policy_type')}")
                summary.append(f"    Coverage: ₹{policy.get('sum_assured', 0):,.2f}")
        
        if result["auto_insurance"]:
            policies = result["auto_insurance"].get("policies", [])
            for policy in policies:
                summary.append(f"  • Auto: {policy.get('policy_number')} - {policy.get('vehicle_make')} {policy.get('vehicle_model')}")
    
    # Trade information
    if result["trade"]:
        trade = result["trade"]
        summary.append("\n📈 **TRADING ACCOUNT:**")
        portfolio = trade.get("portfolio", {})
        summary.append(f"  Total Value: ₹{portfolio.get('total_portfolio_value', 0):,.2f}")
        
        stocks = portfolio.get("stocks", [])
        if stocks:
            summary.append("  📊 **Stock Holdings:**")
            for stock in stocks[:3]:  # Show top 3
                summary.append(f"    • {stock.get('symbol')}: {stock.get('quantity')} shares @ ₹{stock.get('current_price', 0):,.2f}")
    
    return "\n".join(summary)


# Pre-load data on module import
load_customer_data()
