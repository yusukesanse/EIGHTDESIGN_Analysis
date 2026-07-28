function doPostTest2() {
    let request = {
      postData: {
        contents:JSON.stringify({
  "app": {
    "id": "27",
    "name": "営業・商談管理"
  },
  "record": {
    "reason": {
      "type": "DROP_DOWN",
      "value": null
    },
    "レコード番号": {
      "type": "RECORD_NUMBER",
      "value": "4441"
    },
    "occupation": {
      "type": "DROP_DOWN",
      "value": null
    },
    "pair_work_place_shop": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "capital_stock_et": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "competitors": {
      "type": "MULTI_LINE_TEXT",
      "value": ""
    },
    "inquiry_status": {
      "type": "SUBTABLE",
      "value": [
        {
          "id": "468531",
          "value": {
            "inquiry_content": {
              "type": "MULTI_LINE_TEXT",
              "value": "東京オフィスにTEL\n【お名前】小見山 佳奈\n【ふりがな】コミヤマ カナ\n【現在お住まいのエリア】東京都目黒区\n【ご希望の施工エリア】渋谷区元代々木\n【お問い合わせ内容】\n中古マンションを購入し、リノベを検討。\n不動産の引渡は9月予定\nリビングの壁を変えたい。"
            },
            "問い合わせ対応担当者": {
              "type": "USER_SELECT",
              "value": [
                {
                  "code": "hikarikato",
                  "name": "加藤ひかり"
                }
              ]
            },
            "inquiry_date_second": {
              "type": "DATE",
              "value": "2025-07-14"
            },
            "content": {
              "type": "DROP_DOWN",
              "value": "お客様からの問い合わせ（電話）"
            }
          }
        }
      ]
    },
    "annual_income_rental": {
      "type": "NUMBER",
      "value": ""
    },
    "self_funded": {
      "type": "NUMBER",
      "value": ""
    },
    "budget_shop": {
      "type": "NUMBER",
      "value": ""
    },
    "likehood_now": {
      "type": "DROP_DOWN",
      "value": "見込み小"
    },
    "city_ward_shop": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "数値_4": {
      "type": "NUMBER",
      "value": ""
    },
    "数値_3": {
      "type": "NUMBER",
      "value": ""
    },
    "数値_5": {
      "type": "NUMBER",
      "value": ""
    },
    "数値_8": {
      "type": "NUMBER",
      "value": ""
    },
    "数値_9": {
      "type": "NUMBER",
      "value": ""
    },
    "数値_0": {
      "type": "NUMBER",
      "value": ""
    },
    "数値_2": {
      "type": "NUMBER",
      "value": ""
    },
    "数値_1": {
      "type": "NUMBER",
      "value": ""
    },
    "profession_et": {
      "type": "DROP_DOWN",
      "value": null
    },
    "capital_stock": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "$id": {
      "type": "__ID__",
      "value": "4441"
    },
    "capital_stock_rental": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "city": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "文字列__1行_": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "promotion_area": {
      "type": "SINGLE_LINE_TEXT",
      "value": "名古屋"
    },
    "industry": {
      "type": "DROP_DOWN",
      "value": null
    },
    "数値_19": {
      "type": "NUMBER",
      "value": ""
    },
    "数値_16": {
      "type": "NUMBER",
      "value": ""
    },
    "rental_type": {
      "type": "DROP_DOWN",
      "value": null
    },
    "数値_15": {
      "type": "NUMBER",
      "value": ""
    },
    "数値_14": {
      "type": "NUMBER",
      "value": ""
    },
    "update_time": {
      "type": "UPDATED_TIME",
      "value": "2025-08-29T02:17:00Z"
    },
    "数値_13": {
      "type": "NUMBER",
      "value": ""
    },
    "数値_12": {
      "type": "NUMBER",
      "value": ""
    },
    "数値_11": {
      "type": "NUMBER",
      "value": ""
    },
    "文字列__1行__21": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "数値_10": {
      "type": "NUMBER",
      "value": ""
    },
    "文字列__1行__20": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "family_member": {
      "type": "NUMBER",
      "value": ""
    },
    "文字列__1行__22": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "総商談時間": {
      "type": "CALC",
      "value": "03:30"
    },
    "town_village_shop": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "お客様詳細情報": {
      "type": "MULTI_LINE_TEXT",
      "value": ""
    },
    "prefectures_rental": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "funding": {
      "type": "DROP_DOWN",
      "value": null
    },
    "pair_annual_income_0": {
      "type": "NUMBER",
      "value": ""
    },
    "manager": {
      "type": "USER_SELECT",
      "value": [
        {
          "code": "hikarikato",
          "name": "柳田光治"
        }
      ]
    },
    "consultation_content": {
      "type": "SINGLE_LINE_TEXT",
      "value": "部分リノベ"
    },
    "information_route": {
      "type": "SINGLE_LINE_TEXT",
      "value": "雑誌"
    },
    "作成者": {
      "type": "CREATOR",
      "value": {
        "code": "hikarikato",
        "name": "加藤ひかり"
      }
    },
    "own_resources_et": {
      "type": "NUMBER",
      "value": ""
    },
    "prefectures_shop": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "数値_28": {
      "type": "NUMBER",
      "value": ""
    },
    "industry_et": {
      "type": "DROP_DOWN",
      "value": null
    },
    "数値_27": {
      "type": "NUMBER",
      "value": ""
    },
    "official_position_rental": {
      "type": "DROP_DOWN",
      "value": null
    },
    "次アポ_通知用": {
      "type": "DATE",
      "value": "2025-08-12"
    },
    "presence_of_property_shop": {
      "type": "DROP_DOWN",
      "value": null
    },
    "文字列__1行__14": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "数値_26": {
      "type": "NUMBER",
      "value": ""
    },
    "文字列__1行__13": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "数値_25": {
      "type": "NUMBER",
      "value": ""
    },
    "数値_24": {
      "type": "NUMBER",
      "value": ""
    },
    "文字列__1行__16": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "数値_23": {
      "type": "NUMBER",
      "value": ""
    },
    "文字列__1行__15": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "文字列__1行__10": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "数値_22": {
      "type": "NUMBER",
      "value": ""
    },
    "数値_21": {
      "type": "NUMBER",
      "value": ""
    },
    "文字列__1行__12": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "数値_20": {
      "type": "NUMBER",
      "value": ""
    },
    "文字列__1行__11": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "own_resources_rental": {
      "type": "NUMBER",
      "value": ""
    },
    "budget_et": {
      "type": "NUMBER",
      "value": ""
    },
    "customer_name": {
      "type": "SINGLE_LINE_TEXT",
      "value": "テスト 三瀬"
    },
    "文字列__1行__18": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "land_attributes": {
      "type": "DROP_DOWN",
      "value": null
    },
    "official_position_et": {
      "type": "DROP_DOWN",
      "value": null
    },
    "文字列__1行__17": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "city_ward_rental": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "文字列__1行__19": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "income_sub": {
      "type": "NUMBER",
      "value": ""
    },
    "work_place_rental": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "industry_shop": {
      "type": "DROP_DOWN",
      "value": null
    },
    "profession_rental": {
      "type": "DROP_DOWN",
      "value": null
    },
    "work_place": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "hope_renovation": {
      "type": "DROP_DOWN",
      "value": null
    },
    "presence_of_property_rental": {
      "type": "DROP_DOWN",
      "value": null
    },
    "hope_construction": {
      "type": "DROP_DOWN",
      "value": null
    },
    "desired_business_type_et": {
      "type": "DROP_DOWN",
      "value": null
    },
    "文字列__複数行_": {
      "type": "MULTI_LINE_TEXT",
      "value": ""
    },
    "current_residence": {
      "type": "DROP_DOWN",
      "value": null
    },
    "annual_income_et": {
      "type": "NUMBER",
      "value": ""
    },
    "job_title": {
      "type": "DROP_DOWN",
      "value": null
    },
    "budget": {
      "type": "NUMBER",
      "value": ""
    },
    "日付": {
      "type": "DATE",
      "value": null
    },
    "area": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "budget_rental": {
      "type": "NUMBER",
      "value": ""
    },
    "presence_of_property_et": {
      "type": "DROP_DOWN",
      "value": null
    },
    "town": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "予定契約金額": {
      "type": "NUMBER",
      "value": ""
    },
    "area_detail_shop": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "first_appointment": {
      "type": "SINGLE_LINE_TEXT",
      "value": "個別相談"
    },
    "数値": {
      "type": "NUMBER",
      "value": ""
    },
    "ドロップダウン_6": {
      "type": "DROP_DOWN",
      "value": null
    },
    "ドロップダウン_9": {
      "type": "DROP_DOWN",
      "value": null
    },
    "ドロップダウン_8": {
      "type": "DROP_DOWN",
      "value": null
    },
    "ドロップダウン_2": {
      "type": "DROP_DOWN",
      "value": null
    },
    "town_village_rental": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "作成日時": {
      "type": "CREATED_TIME",
      "value": "2025-07-21T04:00:00Z"
    },
    "hope_business_type": {
      "type": "DROP_DOWN",
      "value": null
    },
    "inquiry_date": {
      "type": "DATE",
      "value": "2026-7-28"
    },
    "company_size": {
      "type": "DROP_DOWN",
      "value": null
    },
    "customer_type": {
      "type": "SINGLE_LINE_TEXT",
      "value": "見込み客（住宅リノベーション）"
    },
    "income": {
      "type": "NUMBER",
      "value": ""
    },
    "更新者": {
      "type": "MODIFIER",
      "value": {
        "code": "sanse",
        "name": "三瀬優介"
      }
    },
    "prefectures": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "city_ward_et": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "area_detail_rental": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "annual_income_shop": {
      "type": "NUMBER",
      "value": ""
    },
    "文字列__複数行__0": {
      "type": "MULTI_LINE_TEXT",
      "value": ""
    },
    "販促追客": {
      "type": "RADIO_BUTTON",
      "value": "OK"
    },
    "ドロップダウン_24": {
      "type": "DROP_DOWN",
      "value": null
    },
    "文字列__複数行__3": {
      "type": "MULTI_LINE_TEXT",
      "value": ""
    },
    "emb_et": {
      "type": "DROP_DOWN",
      "value": null
    },
    "work_place_shop": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "planning_home": {
      "type": "DROP_DOWN",
      "value": null
    },
    "child_member": {
      "type": "NUMBER",
      "value": ""
    },
    "文字列__複数行__4": {
      "type": "MULTI_LINE_TEXT",
      "value": ""
    },
    "deal_history": {
      "type": "SUBTABLE",
      "value": [
        {
          "id": "468525",
          "value": {
            "task_detail": {
              "type": "MULTI_LINE_TEXT",
              "value": ""
            },
            "response_date": {
              "type": "DATE",
              "value": "2025-07-14"
            },
            "next_appointment": {
              "type": "DATE",
              "value": "2025-07-20"
            },
            "応対担当": {
              "type": "USER_SELECT",
              "value": [
                {
                  "code": "hikarikato",
                  "name": "加藤ひかり"
                }
              ]
            },
            "ドロップダウン": {
              "type": "DROP_DOWN",
              "value": null
            },
            "商談時間": {
              "type": "CALC",
              "value": "00:00"
            },
            "ドロップダウン_1": {
              "type": "DROP_DOWN",
              "value": "お客様からの問い合わせ（電話）"
            },
            "task_priority": {
              "type": "DROP_DOWN",
              "value": null
            },
            "task_deadline": {
              "type": "DATE",
              "value": null
            },
            "next_direction": {
              "type": "SINGLE_LINE_TEXT",
              "value": ""
            },
            "deal_count": {
              "type": "DROP_DOWN",
              "value": null
            },
            "プレゼン資料添付": {
              "type": "FILE",
              "value": []
            },
            "meeting_content": {
              "type": "MULTI_LINE_TEXT",
              "value": "ご予定確認いただきアポ決定\n7/20(日)16時〜"
            },
            "商談終了": {
              "type": "TIME",
              "value": null
            },
            "商談開始": {
              "type": "TIME",
              "value": null
            }
          }
        },
        {
          "id": "468527",
          "value": {
            "task_detail": {
              "type": "MULTI_LINE_TEXT",
              "value": ""
            },
            "response_date": {
              "type": "DATE",
              "value": "2025-07-20"
            },
            "next_appointment": {
              "type": "DATE",
              "value": null
            },
            "応対担当": {
              "type": "USER_SELECT",
              "value": [
                {
                  "code": "hikarikato",
                  "name": "加藤ひかり"
                },
                {
                  "code": "yanagida",
                  "name": "柳田光治"
                }
              ]
            },
            "ドロップダウン": {
              "type": "DROP_DOWN",
              "value": "エイトデザイン"
            },
            "商談時間": {
              "type": "CALC",
              "value": "01:30"
            },
            "ドロップダウン_1": {
              "type": "DROP_DOWN",
              "value": "打ち合わせ"
            },
            "task_priority": {
              "type": "DROP_DOWN",
              "value": null
            },
            "task_deadline": {
              "type": "DATE",
              "value": null
            },
            "next_direction": {
              "type": "SINGLE_LINE_TEXT",
              "value": ""
            },
            "deal_count": {
              "type": "DROP_DOWN",
              "value": "1回目"
            },
            "プレゼン資料添付": {
              "type": "FILE",
              "value": []
            },
            "meeting_content": {
              "type": "MULTI_LINE_TEXT",
              "value": "初回商談実施\n\nhttps://paper.dropbox.com/doc/20250720--CqDbFu_7eGyrh4q~iWMGCwOcAg-Aajx1zVvxKSiAogVYlV9t\n\nリビング・玄関の壁、照明の改装の部分リノベのため、今後の流れを社内確認。\nディレクターに費用感確認し連絡。\n概算：170万円（税抜）"
            },
            "商談終了": {
              "type": "TIME",
              "value": "17:30"
            },
            "商談開始": {
              "type": "TIME",
              "value": "16:00"
            }
          }
        },
        {
          "id": "470088",
          "value": {
            "task_detail": {
              "type": "MULTI_LINE_TEXT",
              "value": ""
            },
            "response_date": {
              "type": "DATE",
              "value": "2025-07-31"
            },
            "next_appointment": {
              "type": "DATE",
              "value": null
            },
            "応対担当": {
              "type": "USER_SELECT",
              "value": [
                {
                  "code": "suganuma",
                  "name": "菅沼純"
                },
                {
                  "code": "iwamoto",
                  "name": "岩元謙太"
                },
                {
                  "code": "hikarikato",
                  "name": "加藤ひかり"
                }
              ]
            },
            "ドロップダウン": {
              "type": "DROP_DOWN",
              "value": "お客様宅"
            },
            "商談時間": {
              "type": "CALC",
              "value": "01:00"
            },
            "ドロップダウン_1": {
              "type": "DROP_DOWN",
              "value": "現地調査"
            },
            "task_priority": {
              "type": "DROP_DOWN",
              "value": null
            },
            "task_deadline": {
              "type": "DATE",
              "value": null
            },
            "next_direction": {
              "type": "SINGLE_LINE_TEXT",
              "value": ""
            },
            "deal_count": {
              "type": "DROP_DOWN",
              "value": "2回目"
            },
            "プレゼン資料添付": {
              "type": "FILE",
              "value": []
            },
            "meeting_content": {
              "type": "MULTI_LINE_TEXT",
              "value": "現地調査実施\n希望施工内容整理し、概算見積書の提示。\nその後契約の流れ。"
            },
            "商談終了": {
              "type": "TIME",
              "value": "15:30"
            },
            "商談開始": {
              "type": "TIME",
              "value": "14:30"
            }
          }
        },
        {
          "id": "470693",
          "value": {
            "task_detail": {
              "type": "MULTI_LINE_TEXT",
              "value": ""
            },
            "response_date": {
              "type": "DATE",
              "value": "2025-08-06"
            },
            "next_appointment": {
              "type": "DATE",
              "value": null
            },
            "応対担当": {
              "type": "USER_SELECT",
              "value": [
                {
                  "code": "suganuma",
                  "name": "菅沼純"
                },
                {
                  "code": "iwamoto",
                  "name": "岩元謙太"
                },
                {
                  "code": "hikarikato",
                  "name": "加藤ひかり"
                }
              ]
            },
            "ドロップダウン": {
              "type": "DROP_DOWN",
              "value": null
            },
            "商談時間": {
              "type": "CALC",
              "value": "01:00"
            },
            "ドロップダウン_1": {
              "type": "DROP_DOWN",
              "value": null
            },
            "task_priority": {
              "type": "DROP_DOWN",
              "value": null
            },
            "task_deadline": {
              "type": "DATE",
              "value": null
            },
            "next_direction": {
              "type": "SINGLE_LINE_TEXT",
              "value": ""
            },
            "deal_count": {
              "type": "DROP_DOWN",
              "value": ""
            },
            "プレゼン資料添付": {
              "type": "FILE",
              "value": [
                {
                  "fileKey": "202508070224377683D07F32D94BA28D2C9F2DFC6202EB320",
                  "name": "20250806見積書(表紙明細)【M1924076-01】.pdf",
                  "contentType": "application/pdf",
                  "size": "88049"
                },
                {
                  "fileKey": "20250807023057D40165C023EE4DF7AD7D7E9DF8552C8F102",
                  "name": "250801_小見山様_指示書.pdf",
                  "contentType": "application/pdf",
                  "size": "1355460"
                }
              ]
            },
            "meeting_content": {
              "type": "MULTI_LINE_TEXT",
              "value": "見積書のご提示。\n¥3,124,000（税込）\n希望施工内容と合わせて家具造作の提案を含めた内容での金額ご提示。\n初回お打ち合わせ時に伺った内容での概算金額（170万円税抜）からプラスされている部分についての説明をし、金額はご納得いただく。\nとはいえ当初予算200万円からは上振れているため、どう節約していくかは検討したいとのこと。\n8月12日までに進めるか否かご回答いただく。\n"
            },
            "商談終了": {
              "type": "TIME",
              "value": "14:00"
            },
            "商談開始": {
              "type": "TIME",
              "value": "13:00"
            }
          }
        }
      ]
    },
    "prefectures_et": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "work_place_sub": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "$revision": {
      "type": "__REVISION__",
      "value": "6"
    },
    "文字列__1行__0": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "文字列__1行__1": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "area_detail_et": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "文字列__1行__4": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "文字列__1行__5": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "town_village_et": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "文字列__1行__2": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "文字列__1行__3": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "文字列__1行__8": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "industry_rental": {
      "type": "DROP_DOWN",
      "value": null
    },
    "nego_status": {
      "type": "DROP_DOWN",
      "value": "追客中"
    },
    "ドロップダウン_12": {
      "type": "DROP_DOWN",
      "value": null
    },
    "文字列__1行__9": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "文字列__1行__6": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "own_resources_shop": {
      "type": "NUMBER",
      "value": ""
    },
    "文字列__1行__7": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "construction_status": {
      "type": "DROP_DOWN",
      "value": null
    },
    "profession_shop": {
      "type": "DROP_DOWN",
      "value": null
    },
    "日付_0": {
      "type": "DATE",
      "value": null
    },
    "age": {
      "type": "NUMBER",
      "value": ""
    },
    "work_place_et": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    }
  },
        })
      }
    };
    doPost(request);
  }
  