function customersTest() {
    let request = {
      postData: {
        contents:JSON.stringify({
  "app": {
    "id": "20",
    "name": "顧客情報"
  },
  "record": {
    "first_appoint": {
      "type": "DROP_DOWN",
      "value": "その他"
    },
    "与信調査評点": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "レコード番号": {
      "type": "RECORD_NUMBER",
      "value": "56838"
    },
    "address_0": {
      "type": "SINGLE_LINE_TEXT",
      "value": "愛知県"
    },
    "address_1": {
      "type": "SINGLE_LINE_TEXT",
      "value": "岩倉市"
    },
    "address_2": {
      "type": "SINGLE_LINE_TEXT",
      "value": "下本町天神塚38番地1　野村ステイツ岩倉五条川スカイウィング1009号室"
    },
    "zip_code": {
      "type": "NUMBER",
      "value": ""
    },
    "文字列__複数行_": {
      "type": "MULTI_LINE_TEXT",
      "value": ""
    },
    "current_residence": {
      "type": "DROP_DOWN",
      "value": "持家（マンション）"
    },
    "likehood_now": {
      "type": "DROP_DOWN",
      "value": "面識なし"
    },
    "家族情報": {
      "type": "SUBTABLE",
      "value": [
        {
          "id": "392294",
          "value": {
            "文字列__1行__6": {
              "type": "SINGLE_LINE_TEXT",
              "value": ""
            },
            "文字列__1行__7": {
              "type": "SINGLE_LINE_TEXT",
              "value": ""
            },
            "リンク_2": {
              "type": "LINK",
              "value": ""
            },
            "リンク_3": {
              "type": "LINK",
              "value": ""
            },
            "ドロップダウン_5": {
              "type": "DROP_DOWN",
              "value": null
            },
            "生年月日": {
              "type": "DATE",
              "value": null
            }
          }
        }
      ]
    },
    "profession": {
      "type": "DROP_DOWN",
      "value": null
    },
    "other_information_route": {
      "type": "SINGLE_LINE_TEXT",
      "value": "田中さん近隣挨拶"
    },
    "チェックボックス_0": {
      "type": "CHECK_BOX",
      "value": []
    },
    "nnn": {
      "type": "SINGLE_LINE_TEXT",
      "value": "4820005"
    },
    "チェックボックス_1": {
      "type": "CHECK_BOX",
      "value": []
    },
    "ドロップダウン_1": {
      "type": "DROP_DOWN",
      "value": "可"
    },
    "お客様番号": {
      "type": "SINGLE_LINE_TEXT",
      "value": "E-23-1027"
    },
    "ドロップダウン_0": {
      "type": "DROP_DOWN",
      "value": null
    },
    "チェックボックス": {
      "type": "CHECK_BOX",
      "value": []
    },
    "リンク": {
      "type": "LINK",
      "value": ""
    },
    "ドロップダウン_3": {
      "type": "DROP_DOWN",
      "value": "可"
    },
    "ドロップダウン_2": {
      "type": "DROP_DOWN",
      "value": "許可"
    },
    "作成日時": {
      "type": "CREATED_TIME",
      "value": "2023-12-16T04:54:00Z"
    },
    "inquiry_date": {
      "type": "DATE",
      "value": "2026-7-28"
    },
    "$id": {
      "type": "__ID__",
      "value": "56838"
    },
    "customer_type": {
      "type": "DROP_DOWN",
      "value": "見込み客（住宅リノベーション）"
    },
    "更新者": {
      "type": "MODIFIER",
      "value": {
        "code": "sanse",
        "name": "三瀬優介"
      }
    },
    "other_profession": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "promotion_area": {
      "type": "DROP_DOWN",
      "value": "名古屋"
    },
    "文字列__1行_": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "family_member": {
      "type": "NUMBER",
      "value": ""
    },
    "mobile_phone": {
      "type": "SINGLE_LINE_TEXT",
      "value": "090-5396-2634"
    },
    "planning_home": {
      "type": "DROP_DOWN",
      "value": null
    },
    "child_member": {
      "type": "NUMBER",
      "value": ""
    },
    "manager": {
      "type": "USER_SELECT",
      "value": [
        {
          "code": "yanagida",
          "name": "柳田光治"
        }
      ]
    },
    "information_route": {
      "type": "DROP_DOWN",
      "value": "その他"
    },
    "作成者": {
      "type": "CREATOR",
      "value": {
        "code": "yanagida",
        "name": "柳田光治"
      }
    },
    "$revision": {
      "type": "__REVISION__",
      "value": "7"
    },
    "文字列__1行__0": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "文字列__1行__1": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "更新日時": {
      "type": "UPDATED_TIME",
      "value": "2025-11-27T08:05:00Z"
    },
    "文字列__1行__4": {
      "type": "SINGLE_LINE_TEXT",
      "value": "シムラ マサノリ"
    },
    "文字列__1行__13": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "文字列__1行__16": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "文字列__1行__15": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "文字列__1行__9": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "Table_0": {
      "type": "SUBTABLE",
      "value": [
        {
          "id": "392295",
          "value": {
            "ドロップダウン_6": {
              "type": "DROP_DOWN",
              "value": null
            },
            "文字列__1行__18": {
              "type": "SINGLE_LINE_TEXT",
              "value": ""
            },
            "文字列__1行__19": {
              "type": "SINGLE_LINE_TEXT",
              "value": ""
            }
          }
        }
      ]
    },
    "お客様番号_手入力": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "文字列__1行__11": {
      "type": "SINGLE_LINE_TEXT",
      "value": ""
    },
    "ドロップダウン_10": {
      "type": "DROP_DOWN",
      "value": null
    },
    "添付ファイル": {
      "type": "FILE",
      "value": []
    },
    "customer_name": {
      "type": "SINGLE_LINE_TEXT",
      "value": "テスト 三瀬"
    },
    "日付_0": {
      "type": "DATE",
      "value": "2023-12-16"
    },
    "age": {
      "type": "NUMBER",
      "value": ""
    }
  },
        })
      }
    };
    doPost(request);
  }
  